import type {
  ContextDocumentSummary,
  EnabledCollectionInfo,
} from "../../src/context-types";
import { humanizeSkillName } from "./skillName";

export type SkillNavigatorSkill = {
  type: "skill";
  collectionId: string;
  manifestPath: string;
  directoryPath: string;
  name: string;
  description: string;
  lastUpdated: Date;
  /**
   * Why the `SKILL.md` frontmatter failed validation. Such a skill is unusable by agents but is
   * still listed, named after its directory (the collection, at the root), so it can be fixed.
   */
  invalid?: string;
};

export type SkillNavigatorDirectory = {
  type: "directory";
  path: string;
  name: string;
  children: SkillNavigatorNode[];
};

/** A reference document (any file that isn't a skill or one of a skill's supporting files). */
export type SkillNavigatorDocument = {
  type: "document";
  collectionId: string;
  path: string;
  name: string;
  description: string;
  lastUpdated: Date;
};

export type SkillNavigatorNode = SkillNavigatorDirectory | SkillNavigatorSkill | SkillNavigatorDocument;

export type SkillNavigatorCollection = {
  collection: EnabledCollectionInfo;
  children: SkillNavigatorNode[];
};

const directoryName = (path: string) => {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
};

const baseName = (path: string) => {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? path : path.slice(slash + 1);
};

const NODE_ORDER: Record<SkillNavigatorNode["type"], number> = { directory: 0, skill: 1, document: 2 };

const compareNodes = (left: SkillNavigatorNode, right: SkillNavigatorNode) => {
  if (left.type !== right.type) return NODE_ORDER[left.type] - NODE_ORDER[right.type];
  return left.name.localeCompare(right.name);
};

const sortNodes = (nodes: SkillNavigatorNode[]): SkillNavigatorNode[] => nodes
  .map((node) => node.type === "directory"
    ? { ...node, children: sortNodes(node.children) }
    : node)
  .toSorted(compareNodes);

export const buildSkillNavigator = (
  collections: readonly EnabledCollectionInfo[],
  documentsByCollection: ReadonlyMap<string, readonly ContextDocumentSummary[]>,
): SkillNavigatorCollection[] => collections
  .map((collection) => {
    const children: SkillNavigatorNode[] = [];
    const directories = new Map<string, SkillNavigatorDirectory>();

    const getDirectory = (path: string): SkillNavigatorDirectory => {
      const existing = directories.get(path);
      if (existing) return existing;

      const directory: SkillNavigatorDirectory = {
        type: "directory",
        path,
        name: baseName(path),
        children: [],
      };
      directories.set(path, directory);

      const parentPath = directoryName(path);
      if (parentPath) getDirectory(parentPath).children.push(directory);
      else children.push(directory);
      return directory;
    };

    const documents = documentsByCollection.get(collection.id) ?? [];
    // A skill owns its directory, so files under it are supporting files rather than documents. A
    // manifest at the collection root makes the whole collection one skill.
    const skillDirectories = documents
      .filter((document) => document.skillName || document.skillError)
      .map((document) => directoryName(document.path));
    const insideSkill = (path: string) => skillDirectories.some((directory) =>
      directory === "" || path.startsWith(`${directory}/`));

    for (const document of documents) {
      if (!document.skillName && !document.skillError) {
        if (insideSkill(document.path)) continue;
        const parent = directoryName(document.path);
        const node: SkillNavigatorDocument = {
          type: "document",
          collectionId: collection.id,
          path: document.path,
          name: baseName(document.path),
          description: document.description,
          lastUpdated: document.lastUpdated,
        };
        if (parent) getDirectory(parent).children.push(node);
        else children.push(node);
        continue;
      }

      const skillDirectory = directoryName(document.path);
      const parentDirectory = directoryName(skillDirectory);
      const skill: SkillNavigatorSkill = {
        type: "skill",
        collectionId: collection.id,
        manifestPath: document.path,
        directoryPath: skillDirectory,
        name: document.skillName ?? (baseName(skillDirectory) || collection.title),
        description: document.description,
        lastUpdated: document.lastUpdated,
        ...(document.skillError && !document.skillName ? { invalid: document.skillError } : {}),
      };

      if (parentDirectory) getDirectory(parentDirectory).children.push(skill);
      else children.push(skill);
    }

    return { collection, children: sortNodes(children) };
  })
  .toSorted((left, right) => left.collection.title.localeCompare(right.collection.title));

/**
 * A valid skill's metadata name as a title. An invalid skill has no metadata name, so it shows its
 * directory name or collection title verbatim, as directory rows do.
 */
export const skillDisplayName = (skill: SkillNavigatorSkill) =>
  skill.invalid ? skill.name : humanizeSkillName(skill.name);

const includesQuery = (value: string, query: string) => value.toLowerCase().includes(query);

const filterNodes = (
  nodes: readonly SkillNavigatorNode[],
  query: string,
): SkillNavigatorNode[] => {
  const matches: SkillNavigatorNode[] = [];
  for (const node of nodes) {
    if (node.type === "skill") {
      if (includesQuery(skillDisplayName(node), query)
        // An invalid skill's description is not shown, so it cannot explain a match.
        || (!node.invalid && includesQuery(node.description, query))) {
        matches.push(node);
      }
      continue;
    }
    if (node.type === "document") {
      if (includesQuery(node.name, query) || includesQuery(node.description, query)) {
        matches.push(node);
      }
      continue;
    }

    if (includesQuery(node.name, query)) {
      matches.push(node);
      continue;
    }
    const children = filterNodes(node.children, query);
    if (children.length > 0) matches.push({ ...node, children });
  }
  return matches;
};

export const filterSkillNavigator = (
  collections: readonly SkillNavigatorCollection[],
  value: string,
): SkillNavigatorCollection[] => {
  const query = value.trim().toLowerCase();
  if (!query) return [...collections];

  return collections.flatMap(({ collection, children }) => {
    const collectionMatches = includesQuery(collection.title, query)
      || includesQuery(collection.description, query);
    const filteredChildren = collectionMatches ? children : filterNodes(children, query);
    return collectionMatches || filteredChildren.length > 0
      ? [{ collection, children: filteredChildren }]
      : [];
  });
};

export const countSkills = (nodes: readonly SkillNavigatorNode[]): number => nodes.reduce(
  (count, node) => count + (node.type === "skill"
    ? 1
    : node.type === "directory" ? countSkills(node.children) : 0),
  0,
);

export const countDocuments = (nodes: readonly SkillNavigatorNode[]): number => nodes.reduce(
  (count, node) => count + (node.type === "document"
    ? 1
    : node.type === "directory" ? countDocuments(node.children) : 0),
  0,
);
