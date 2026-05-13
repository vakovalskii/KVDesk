/**
 * Code Sandbox - Execute JS/Python code securely
 * 
 * Uses Node.js vm module which works reliably in pkg binary
 * (For Rust-native sandbox, use Tauri command sandbox_execute directly)
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join, resolve, dirname, basename, extname } from 'path';
import * as vm from 'vm';
import { spawn } from 'child_process';

export interface SandboxResult {
  success: boolean;
  output: string;
  error?: string;
  logs: string[];
  language?: string;
}

/**
 * Execute JavaScript code in sandbox
 */
export async function executeInQuickJS(
  code: string,
  cwd: string,
  isPathSafe: (path: string) => boolean,
  timeout: number = 5000
): Promise<SandboxResult> {
  const logs: string[] = [];
  
  try {
    // Create sandbox context with allowed APIs
    const sandbox: any = {
      console: {
        log: (...args: any[]) => {
          const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' ');
          logs.push(msg);
        },
        error: (...args: any[]) => {
          const msg = `ERROR: ${args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' ')}`;
          logs.push(msg);
        },
        warn: (...args: any[]) => {
          const msg = `WARN: ${args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' ')}`;
          logs.push(msg);
        },
        info: (...args: any[]) => {
          const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' ');
          logs.push(msg);
        }
      },
      fs: {
        readFileSync: (filePath: string, encoding?: string) => {
          const fullPath = resolve(cwd, filePath.startsWith('/') ? filePath.slice(1) : filePath);
          if (!isPathSafe(fullPath)) {
            throw new Error(`Access denied: ${filePath} is outside workspace`);
          }
          return readFileSync(fullPath, (encoding as BufferEncoding) || 'utf-8');
        },
        writeFileSync: (filePath: string, data: string) => {
          const fullPath = resolve(cwd, filePath.startsWith('/') ? filePath.slice(1) : filePath);
          if (!isPathSafe(fullPath)) {
            throw new Error(`Access denied: ${filePath} is outside workspace`);
          }
          writeFileSync(fullPath, data, 'utf-8');
        },
        existsSync: (filePath: string) => {
          const fullPath = resolve(cwd, filePath.startsWith('/') ? filePath.slice(1) : filePath);
          return existsSync(fullPath);
        },
        readdirSync: (dirPath: string) => {
          const fullPath = resolve(cwd, dirPath.startsWith('/') ? dirPath.slice(1) : dirPath);
          if (!isPathSafe(fullPath)) {
            throw new Error(`Access denied: ${dirPath} is outside workspace`);
          }
          return readdirSync(fullPath);
        }
      },
      path: {
        join: (...parts: string[]) => join(...parts),
        resolve: (...parts: string[]) => resolve(...parts),
        dirname: (p: string) => dirname(p),
        basename: (p: string) => basename(p),
        extname: (p: string) => extname(p)
      },
      __dirname: cwd,
      JSON,
      Math,
      Date,
      Array,
      Object,
      String,
      Number,
      Boolean,
      RegExp,
      Error,
      parseInt,
      parseFloat,
      isNaN,
      isFinite,
      encodeURIComponent,
      decodeURIComponent,
      encodeURI,
      decodeURI,
      // Disabled for security
      setTimeout: undefined,
      setInterval: undefined,
      fetch: undefined,
      require: undefined,
      process: undefined,
      global: undefined,
      globalThis: undefined,
    };
    
    // Create VM context
    const context = vm.createContext(sandbox);
    
    // Wrap code to capture return value
    const wrappedCode = `
(function() {
  "use strict";
  ${code}
})()
`;
    
    // Execute with timeout
    const script = new vm.Script(wrappedCode, { filename: 'sandbox.js' });
    const result = script.runInContext(context, { timeout });
    
    let outputStr = '';
    if (result !== undefined) {
      outputStr = typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result);
    }
    
    return {
      success: true,
      output: outputStr,
      logs,
      language: 'javascript'
    };
    
  } catch (error: any) {
    return {
      success: false,
      output: '',
      error: error.message,
      logs,
      language: 'javascript'
    };
  }
}

const PYTHON_ENCODING_WRAPPER = `
import sys; sys.stdout.reconfigure(encoding='utf-8'); sys.stderr.reconfigure(encoding='utf-8')
import urllib.request

# Monkey-patches urllib and requests to auto-detect encoding (cp1251/utf-8/koi8-r).
# Safe here because: each execute_python call spawns a fresh subprocess, so patches
# are isolated to that single execution and never leak to other code.

_orig_urlopen = urllib.request.urlopen

def _detect_and_decode(raw_bytes):
    if isinstance(raw_bytes, str):
        return raw_bytes.encode('utf-8')
    charset = None
    ct = None
    for header_name in ('content-type', 'Content-Type'):
        try:
            ct = raw_bytes.headers.get(header_name, '')
        except Exception:
            pass
    if ct and 'charset=' in ct:
        charset = ct.split('charset=')[-1].split(';')[0].strip()
    if not charset:
        try:
            import chardet
            det = chardet.detect(raw_bytes[:8192] if hasattr(raw_bytes, '__getitem__') else raw_bytes)
            charset = det.get('encoding') if det and det.get('confidence', 0) > 0.7 else None
        except Exception:
            pass  # chardet optional, fall through to encoding guesses
    for enc in (charset, 'cp1251', 'windows-1251', 'utf-8', 'koi8-r'):
        if not enc:
            continue
        try:
            return raw_bytes.decode(enc).encode('utf-8')
        except Exception:
            pass
    return raw_bytes.decode('utf-8', errors='replace').encode('utf-8')

class _AutoDecodeResponse:
    def __init__(self, original_response):
        self._orig = original_response
        try:
            self.content = _detect_and_decode(original_response.read())
        except Exception as e:
            sys.stderr.write('[encoding-wrapper] Failed to decode response: ' + str(e) + '\\n')
            self.content = original_response.read()
    def read(self, n=-1):
        if n < 0:
            return self.content
        return self.content[:n]
    def __getattr__(self, name):
        return getattr(self._orig, name)

def _auto_urlopen(url, *args, **kwargs):
    response = _orig_urlopen(url, *args, **kwargs)
    try:
        return _AutoDecodeResponse(response)
    except Exception as e:
        sys.stderr.write('[encoding-wrapper] Failed to wrap urlopen response: ' + str(e) + '\\n')
        return response

urllib.request.urlopen = _auto_urlopen

try:
    import requests

    _orig_requests_get = requests.get
    _orig_requests_session_request = None

    class _AutoDecodeRequestsResponse:
        def __init__(self, original_response):
            self._orig = original_response
            try:
                raw = original_response.content
                self._decoded = _detect_and_decode(raw)
            except Exception as e:
                sys.stderr.write('[encoding-wrapper] Failed to decode requests response: ' + str(e) + '\\n')
                self._decoded = original_response.content
        @property
        def content(self):
            return self._decoded
        @property
        def text(self):
            return self._decoded.decode('utf-8', errors='replace')
        def __getattr__(self, name):
            return getattr(self._orig, name)

    def _auto_requests_get(url, **kwargs):
        resp = _orig_requests_get(url, **kwargs)
        try:
            return _AutoDecodeRequestsResponse(resp)
        except Exception as e:
            sys.stderr.write('[encoding-wrapper] Failed to wrap requests.get: ' + str(e) + '\\n')
            return resp

    def _auto_requests_session_init(self, *args, **kwargs):
        _orig_requests_session_init(self, *args, **kwargs)
        _orig_session_request = self.request
        def _auto_session_request(method, url, **kw):
            resp = _orig_session_request(method, url, **kw)
            try:
                return _AutoDecodeRequestsResponse(resp)
            except Exception:
                return resp
        self.request = _auto_session_request

    _orig_requests_session_init = requests.Session.__init__
    requests.Session.__init__ = _auto_requests_session_init
    requests.get = _auto_requests_get
except Exception as e:
    sys.stderr.write('[encoding-wrapper] Failed to patch requests library: ' + str(e) + '\\n')
`;

/**
 * Execute Python code (requires Python 3 installed)
 */
export async function executePython(
  code: string,
  cwd: string,
  _isPathSafe: (path: string) => boolean,
  timeout: number = 30000
): Promise<SandboxResult> {
  return new Promise((promiseResolve) => {
    const logs: string[] = [];
    let stdout = '';
    let stderr = '';
    
    // Find Python
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
    
    const wrappedCode = PYTHON_ENCODING_WRAPPER + '\n\n' + code;
    
    const proc = spawn(pythonCmd, ['-c', wrappedCode], {
      cwd,
      timeout,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    proc.stdout.on('data', (data) => {
      const text = data.toString();
      stdout += text;
      logs.push(...text.split('\n').filter((l: string) => l.trim()));
    });
    
    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    proc.on('close', (exitCode) => {
      if (exitCode === 0) {
        promiseResolve({
          success: true,
          output: stdout.trim(),
          logs,
          language: 'python'
        });
      } else {
        promiseResolve({
          success: false,
          output: stdout,
          error: stderr || `Python exited with code ${exitCode}`,
          logs,
          language: 'python'
        });
      }
    });
    
    proc.on('error', (err) => {
      promiseResolve({
        success: false,
        output: '',
        error: `Failed to execute Python: ${err.message}. Make sure Python 3 is installed.`,
        logs,
        language: 'python'
      });
    });
  });
}
