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
  options: { skillName?: string; description?: string } = {},
): ContextDocumentSummary => ({
  path,
  name: path.split("/").at(-1) ?? path,
  description: options.description ?? "",
  contentType: "text/markdown",
  skillName: options.skillName,
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
});
