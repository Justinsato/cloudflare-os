import { describe, expect, it } from "vitest";
import type {
  ContextDocumentSummary,
  EnabledCollectionInfo,
} from "../../src/context-types";
import {
  buildSkillNavigator,
  countDocuments,
  countSkills,
  filterSkillNavigator,
} from "./skillNavigatorModel";

const collection = (
  id: string,
  title: string,
  description = "",
): EnabledCollectionInfo => ({
  id,
  title,
  description,
  source: "private",
  lastUpdated: new Date(0),
});

const document = (
  path: string,
  options: { skillName?: string; skillError?: string; description?: string } = {},
): ContextDocumentSummary => ({
  path,
  name: path.split("/").at(-1) ?? path,
  description: options.description ?? "",
  contentType: "text/markdown",
  skillName: options.skillName,
  skillError: options.skillError,
  lastUpdated: new Date(0),
});

describe("skillNavigatorModel", () => {
  it("lists collections, skill ancestors, skills, and reference documents", () => {
    const collections = [collection("product", "Product"), collection("empty", "Empty")];
    const documents = new Map([
      ["product", [
        document("context/roadmap.md", { description: "Context only" }),
        document("skills/release/SKILL.md", {
          skillName: "release",
          description: "Ship a release",
        }),
        document("skills/release/references/checklist.md"),
        document("teams/design/review/SKILL.md", { skillName: "review" }),
      ]],
    ]);

    expect(buildSkillNavigator(collections, documents)).toMatchObject([
      { collection: { title: "Empty" }, children: [] },
      {
        collection: { title: "Product" },
        children: [
          {
            type: "directory",
            path: "context",
            children: [{
              type: "document",
              path: "context/roadmap.md",
              name: "roadmap.md",
              description: "Context only",
            }],
          },
          {
            type: "directory",
            path: "skills",
            children: [{ type: "skill", name: "release" }],
          },
          {
            type: "directory",
            path: "teams",
            children: [{
              type: "directory",
              path: "teams/design",
              children: [{ type: "skill", name: "review" }],
            }],
          },
        ],
      },
    ]);
  });

  it("matches collection metadata, directories, skill names, and descriptions", () => {
    const navigator = buildSkillNavigator(
      [collection("product", "Product", "Launch work")],
      new Map([["product", [
        document("skills/release/SKILL.md", {
          skillName: "release-readiness",
          description: "Publish changes",
        }),
        document("teams/design/review/SKILL.md", {
          skillName: "review",
          description: "Check a pull request",
        }),
      ]]]),
    );

    expect(filterSkillNavigator(navigator, "publish")[0].children).toMatchObject([
      { path: "skills", children: [{ name: "release-readiness" }] },
    ]);
    expect(filterSkillNavigator(navigator, "release readiness")[0].children).toMatchObject([
      { path: "skills", children: [{ name: "release-readiness" }] },
    ]);
    expect(filterSkillNavigator(navigator, "design")[0].children).toMatchObject([
      { path: "teams", children: [{ path: "teams/design", children: [{ name: "review" }] }] },
    ]);
    expect(filterSkillNavigator(navigator, "launch")[0].children).toEqual(navigator[0].children);
    expect(filterSkillNavigator(navigator, "missing")).toEqual([]);
  });

  it("lists a collection of plain documents and hides a skill's supporting files", () => {
    const navigator = buildSkillNavigator(
      [collection("standards", "Standards")],
      new Map([["standards", [
        document("README.md", { description: "Index" }),
        document("writing.md"),
        document("apps/01-leasing.md"),
        document("apps/02-brickston.md"),
        document("skills/release/SKILL.md", { skillName: "release" }),
        document("skills/release/references/checklist.md"),
      ]]]),
    );

    expect(navigator[0].children).toEqual([
      expect.objectContaining({
        type: "directory",
        path: "apps",
        children: [
          expect.objectContaining({ type: "document", path: "apps/01-leasing.md" }),
          expect.objectContaining({ type: "document", path: "apps/02-brickston.md" }),
        ],
      }),
      expect.objectContaining({
        type: "directory",
        path: "skills",
        children: [expect.objectContaining({ type: "skill", name: "release" })],
      }),
      expect.objectContaining({ type: "document", path: "README.md", collectionId: "standards" }),
      expect.objectContaining({ type: "document", path: "writing.md" }),
    ]);
    expect(countDocuments(navigator[0].children)).toBe(4);
    expect(countSkills(navigator[0].children)).toBe(1);
  });

  it("matches documents by file name and description", () => {
    const navigator = buildSkillNavigator(
      [collection("standards", "Standards")],
      new Map([["standards", [
        document("writing-standards.md", { description: "House writing rules" }),
        document("apps/03-watch.md", { description: "Permits and violations" }),
      ]]]),
    );

    expect(filterSkillNavigator(navigator, "writing")[0].children).toMatchObject([
      { type: "document", path: "writing-standards.md" },
    ]);
    expect(filterSkillNavigator(navigator, "violations")[0].children).toMatchObject([
      { path: "apps", children: [{ type: "document", path: "apps/03-watch.md" }] },
    ]);
  });

  it("keeps an empty collection when its metadata matches", () => {
    const navigator = buildSkillNavigator(
      [collection("empty", "Empty collection", "No skills yet")],
      new Map(),
    );

    expect(filterSkillNavigator(navigator, "empty")).toEqual(navigator);
  });

  it("lists a valid collection-root manifest as a top-level skill", () => {
    expect(buildSkillNavigator(
      [collection("pricing", "Pricing")],
      new Map([["pricing", [
        document("SKILL.md", { skillName: "pricing-analytics", description: "Pricing data" }),
        document("references/tables.md"),
      ]]]),
    )[0].children).toEqual([{
      type: "skill",
      collectionId: "pricing",
      manifestPath: "SKILL.md",
      directoryPath: "",
      name: "pricing-analytics",
      description: "Pricing data",
      lastUpdated: new Date(0),
    }]);
  });

  it("keeps invalid manifests, named after their directory or collection", () => {
    const navigator = buildSkillNavigator(
      [collection("pricing", "Pricing analytics")],
      new Map([["pricing", [
        document("SKILL.md", {
          skillError: "Skill frontmatter is not valid YAML.",
          description: "Tables covered: invoices",
        }),
        document("skills/forecast/SKILL.md", {
          skillError: "Skill description must be at most 1024 characters.",
        }),
      ]]]),
    );

    expect(navigator[0].children).toMatchObject([
      {
        type: "directory",
        path: "skills",
        children: [{
          type: "skill",
          manifestPath: "skills/forecast/SKILL.md",
          name: "forecast",
          invalid: "Skill description must be at most 1024 characters.",
        }],
      },
      {
        type: "skill",
        manifestPath: "SKILL.md",
        name: "Pricing analytics",
        invalid: "Skill frontmatter is not valid YAML.",
      },
    ]);
    expect(filterSkillNavigator(navigator, "forecast")[0].children).toMatchObject([
      { path: "skills", children: [{ name: "forecast" }] },
    ]);
    // The description of an invalid manifest is not displayed, so it does not match.
    expect(filterSkillNavigator(navigator, "invoices")).toEqual([]);
  });

  // Brick: plain documents are listed as documents (see SkillNavigatorDocument), never as skills.
  it("gives a collection of plain documents no skills", () => {
    const navigator = buildSkillNavigator(
      [collection("notes", "Notes")],
      new Map([["notes", [document("README.md"), document("guides/SKILL.txt")]]]),
    );
    expect(navigator).toMatchObject([{ collection: { title: "Notes" } }]);
    expect(countSkills(navigator[0].children)).toBe(0);
    expect(countDocuments(navigator[0].children)).toBe(2);
  });
});
