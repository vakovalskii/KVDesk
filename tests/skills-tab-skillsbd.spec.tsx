import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithI18n } from "./test-utils";
import { SkillsTab } from "../src/ui/components/SkillsTab";
import type { Skill, SkillRepository } from "../src/ui/types";

const mockSendClientEvent = vi.fn();
const mockInvoke = vi.fn();

vi.mock("../src/ui/platform", () => ({
  getPlatform: vi.fn(() => ({
    sendClientEvent: mockSendClientEvent,
    invoke: mockInvoke,
    onServerEvent: vi.fn(() => () => {}),
    selectDirectory: vi.fn()
  }))
}));

vi.mock("../src/ui/store/useAppStore", () => ({
  useAppStore: vi.fn((selector: (s: unknown) => unknown) => {
    const state = {};
    return selector(state);
  })
}));

describe("SkillsTab — SkillsBD support", () => {
  const skillsbdRepo: SkillRepository = {
    id: "skillsbd-default",
    name: "SkillsBD",
    type: "skillsbd",
    url: "https://skillsbd.ru",
    enabled: true
  };

  const githubRepo: SkillRepository = {
    id: "default",
    name: "Default",
    type: "github",
    url: "https://api.github.com/repos/example/repo/contents/skills",
    enabled: true
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders skillsbd repository badge with orange color", async () => {
    renderWithI18n(
      <SkillsTab
        skills={[]}
        repositories={[skillsbdRepo]}
        loading={false}
        error={null}
        onToggleSkill={vi.fn()}
        onRefresh={vi.fn()}
        onAddRepository={vi.fn()}
        onUpdateRepository={vi.fn()}
        onRemoveRepository={vi.fn()}
        onToggleRepository={vi.fn()}
      />
    );

    await waitFor(() => {
      const badges = screen.getAllByText("SkillsBD");
      expect(badges.length).toBeGreaterThan(0);
    });

    const badges = screen.getAllByText("SkillsBD");
    const repoBadge = badges.find(badge => 
      badge.className.includes("bg-orange-100") && badge.className.includes("text-orange-700")
    );
    expect(repoBadge).toBeDefined();
  });

  it("renders featured badge for featured skills", async () => {
    const featuredSkill: Skill = {
      id: "featured-skill",
      name: "Featured Skill",
      description: "This is featured",
      repoPath: "owner/repo",
      repositoryId: "skillsbd-default",
      enabled: false,
      featured: true
    };

    renderWithI18n(
      <SkillsTab
        skills={[featuredSkill]}
        repositories={[skillsbdRepo]}
        loading={false}
        error={null}
        onToggleSkill={vi.fn()}
        onRefresh={vi.fn()}
        onAddRepository={vi.fn()}
        onUpdateRepository={vi.fn()}
        onRemoveRepository={vi.fn()}
        onToggleRepository={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Featured")).toBeInTheDocument();
    });

    const featuredBadge = screen.getByText("Featured");
    expect(featuredBadge.className).toContain("bg-yellow-100");
    expect(featuredBadge.className).toContain("text-yellow-700");
  });

  it("renders skill tags", async () => {
    const skillWithTags: Skill = {
      id: "tagged-skill",
      name: "Tagged Skill",
      description: "Has tags",
      repoPath: "owner/repo",
      repositoryId: "skillsbd-default",
      enabled: false,
      tags: ["ai", "coding", "productivity"]
    };

    renderWithI18n(
      <SkillsTab
        skills={[skillWithTags]}
        repositories={[skillsbdRepo]}
        loading={false}
        error={null}
        onToggleSkill={vi.fn()}
        onRefresh={vi.fn()}
        onAddRepository={vi.fn()}
        onUpdateRepository={vi.fn()}
        onRemoveRepository={vi.fn()}
        onToggleRepository={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("ai")).toBeInTheDocument();
      expect(screen.getByText("coding")).toBeInTheDocument();
      expect(screen.getByText("productivity")).toBeInTheDocument();
    });
  });

  it("renders installs counter with icon", async () => {
    const skillWithInstalls: Skill = {
      id: "popular-skill",
      name: "Popular Skill",
      description: "Many installs",
      repoPath: "owner/repo",
      repositoryId: "skillsbd-default",
      enabled: false,
      installs: 250
    };

    const { container } = renderWithI18n(
      <SkillsTab
        skills={[skillWithInstalls]}
        repositories={[skillsbdRepo]}
        loading={false}
        error={null}
        onToggleSkill={vi.fn()}
        onRefresh={vi.fn()}
        onAddRepository={vi.fn()}
        onUpdateRepository={vi.fn()}
        onRemoveRepository={vi.fn()}
        onToggleRepository={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Popular Skill")).toBeInTheDocument();
    });

    const installsSpan = container.querySelector('span.flex.items-center.gap-1');
    expect(installsSpan).toBeDefined();
    expect(installsSpan?.textContent).toContain("250");
    expect(installsSpan?.textContent).toContain("installs");
  });

  it("does not render featured badge when featured is false or undefined", async () => {
    const normalSkill: Skill = {
      id: "normal-skill",
      name: "Normal Skill",
      description: "Not featured",
      repoPath: "owner/repo",
      repositoryId: "skillsbd-default",
      enabled: false,
      featured: false
    };

    renderWithI18n(
      <SkillsTab
        skills={[normalSkill]}
        repositories={[skillsbdRepo]}
        loading={false}
        error={null}
        onToggleSkill={vi.fn()}
        onRefresh={vi.fn()}
        onAddRepository={vi.fn()}
        onUpdateRepository={vi.fn()}
        onRemoveRepository={vi.fn()}
        onToggleRepository={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Normal Skill")).toBeInTheDocument();
    });

    expect(screen.queryByText("Featured")).not.toBeInTheDocument();
  });

  it("does not render tags when tags array is empty or undefined", async () => {
    const skillNoTags: Skill = {
      id: "no-tags-skill",
      name: "No Tags Skill",
      description: "No tags",
      repoPath: "owner/repo",
      repositoryId: "skillsbd-default",
      enabled: false,
      tags: []
    };

    renderWithI18n(
      <SkillsTab
        skills={[skillNoTags]}
        repositories={[skillsbdRepo]}
        loading={false}
        error={null}
        onToggleSkill={vi.fn()}
        onRefresh={vi.fn()}
        onAddRepository={vi.fn()}
        onUpdateRepository={vi.fn()}
        onRemoveRepository={vi.fn()}
        onToggleRepository={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("No Tags Skill")).toBeInTheDocument();
    });

    const tagElements = screen.queryAllByText(/^(ai|coding|productivity)$/);
    expect(tagElements).toHaveLength(0);
  });

  it("skillsbd option is present in repository type selector", async () => {
    const onAddRepository = vi.fn();

    renderWithI18n(
      <SkillsTab
        skills={[]}
        repositories={[githubRepo]}
        loading={false}
        error={null}
        onToggleSkill={vi.fn()}
        onRefresh={vi.fn()}
        onAddRepository={onAddRepository}
        onUpdateRepository={vi.fn()}
        onRemoveRepository={vi.fn()}
        onToggleRepository={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Repositories")).toBeInTheDocument();
    });

    const addButton = screen.getByText("Add Repository");
    fireEvent.click(addButton);

    await waitFor(() => {
      const dialogTitle = screen.getAllByText("Add Repository");
      expect(dialogTitle.length).toBeGreaterThan(0);
    });

    const selects = screen.getAllByRole("combobox");
    const typeSelect = selects.find(select => {
      const options = Array.from(select.querySelectorAll("option"));
      return options.some(opt => (opt as HTMLOptionElement).value === "skillsbd");
    });

    expect(typeSelect).toBeDefined();
    const options = Array.from(typeSelect!.querySelectorAll("option"));
    const skillsbdOption = options.find(opt => (opt as HTMLOptionElement).value === "skillsbd");
    expect(skillsbdOption).toBeDefined();
    expect(skillsbdOption?.textContent).toBe("SkillsBD");
  });

  it("shows correct URL placeholder for skillsbd type", async () => {
    renderWithI18n(
      <SkillsTab
        skills={[]}
        repositories={[githubRepo]}
        loading={false}
        error={null}
        onToggleSkill={vi.fn()}
        onRefresh={vi.fn()}
        onAddRepository={vi.fn()}
        onUpdateRepository={vi.fn()}
        onRemoveRepository={vi.fn()}
        onToggleRepository={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Add Repository")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Add Repository"));

    await waitFor(() => {
      const dialogTitle = screen.getAllByText("Add Repository");
      expect(dialogTitle.length).toBeGreaterThan(0);
    });

    const selects = screen.getAllByRole("combobox");
    const typeSelect = selects.find(select => {
      const options = Array.from(select.querySelectorAll("option"));
      return options.some(opt => (opt as HTMLOptionElement).value === "skillsbd");
    }) as HTMLSelectElement;

    expect(typeSelect).toBeDefined();
    fireEvent.change(typeSelect, { target: { value: "skillsbd" } });

    await waitFor(() => {
      const urlInput = screen.getByPlaceholderText("https://skillsbd.ru");
      expect(urlInput).toBeInTheDocument();
    });
  });

  it("renders all skillsbd-specific fields together", async () => {
    const fullSkillsbdSkill: Skill = {
      id: "full-skill",
      name: "Full SkillsBD Skill",
      description: "Has all skillsbd fields",
      repoPath: "owner/repo",
      repositoryId: "skillsbd-default",
      enabled: false,
      featured: true,
      tags: ["ai", "automation"],
      installs: 500,
      trending24h: 25,
      author: "Test Author",
      authorName: "Test Author",
      owner: "testowner",
      repo: "testrepo",
      version: "2.0",
      license: "MIT",
      telegramLink: "https://t.me/testauthor"
    };

    renderWithI18n(
      <SkillsTab
        skills={[fullSkillsbdSkill]}
        repositories={[skillsbdRepo]}
        loading={false}
        error={null}
        onToggleSkill={vi.fn()}
        onRefresh={vi.fn()}
        onAddRepository={vi.fn()}
        onUpdateRepository={vi.fn()}
        onRemoveRepository={vi.fn()}
        onToggleRepository={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Full SkillsBD Skill")).toBeInTheDocument();
      expect(screen.getByText("Featured")).toBeInTheDocument();
      expect(screen.getByText("ai")).toBeInTheDocument();
      expect(screen.getByText("automation")).toBeInTheDocument();
      expect(screen.getByText(/500/)).toBeInTheDocument();
      expect(screen.getByText(/installs/)).toBeInTheDocument();
      expect(screen.getByText("by Test Author")).toBeInTheDocument();
      expect(screen.getByText("v2.0")).toBeInTheDocument();
      expect(screen.getByText("MIT")).toBeInTheDocument();
    });
  });
});
