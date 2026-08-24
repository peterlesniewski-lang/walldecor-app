import type { FormQuestion } from './form-visibility'

export type QuestionPlacement = {
  parentKey: string | null
  equals: string | null
}

export type QuestionTreeNode<T extends FormQuestion = FormQuestion> = {
  question: T
  branches: QuestionTreeBranch<T>[]
}

export type QuestionTreeBranch<T extends FormQuestion = FormQuestion> = {
  value: string
  label: string
  children: QuestionTreeNode<T>[]
}

export type QuestionForest<T extends FormQuestion = FormQuestion> = {
  roots: QuestionTreeNode<T>[]
  detached: T[]
}

export type QuestionBranchChoice = {
  value: string
  label: string
}

const yesNoUnknownChoices: readonly QuestionBranchChoice[] = [
  { value: 'YES', label: 'Tak' },
  { value: 'NO', label: 'Nie' },
  { value: 'UNKNOWN', label: 'Nie wiem' },
]

/** Values that may be used to create a visible conditional branch. */
export function branchChoices(question: FormQuestion): QuestionBranchChoice[] {
  if (question.type === 'YES_NO_UNKNOWN') return [...yesNoUnknownChoices]
  if (question.type === 'SINGLE') {
    return (question.options ?? []).map((option) => ({ value: option, label: option }))
  }
  return []
}

/**
 * Builds the renderable part of the question graph. Records that cannot be
 * connected to a root remain in detached, so callers can surface a warning
 * while the schema validator still receives every original record.
 */
export function buildQuestionForest<T extends FormQuestion>(questions: readonly T[]): QuestionForest<T> {
  const keyCounts = new Map<string, number>()
  for (const question of questions) {
    keyCounts.set(question.key, (keyCounts.get(question.key) ?? 0) + 1)
  }

  const uniqueKeyIndexes = new Map<string, number>()
  questions.forEach((question, index) => {
    if (keyCounts.get(question.key) === 1) uniqueKeyIndexes.set(question.key, index)
  })

  const nodes = questions.map((question) => ({
    question,
    branches: branchChoices(question).map(({ value, label }) => ({ value, label, children: [] })),
  }) as QuestionTreeNode<T>)
  const roots: QuestionTreeNode<T>[] = []

  questions.forEach((question, index) => {
    if (!question.condition) {
      roots.push(nodes[index])
      return
    }

    const parentIndex = uniqueKeyIndexes.get(question.condition.questionKey)
    if (parentIndex === undefined || parentIndex === index) return

    const branch = nodes[parentIndex].branches.find(({ value }) => value === question.condition?.equals)
    if (!branch) return
    branch.children.push(nodes[index])
  })

  const nodeIndexes = new Map<QuestionTreeNode<T>, number>()
  nodes.forEach((node, index) => nodeIndexes.set(node, index))
  const reachableIndexes = new Set<number>()
  const visited = new Set<QuestionTreeNode<T>>()
  const stack = [...roots].reverse()

  while (stack.length > 0) {
    const node = stack.pop()
    if (!node || visited.has(node)) continue

    visited.add(node)
    const index = nodeIndexes.get(node)
    if (index !== undefined) reachableIndexes.add(index)

    for (let branchIndex = node.branches.length - 1; branchIndex >= 0; branchIndex -= 1) {
      const children = node.branches[branchIndex].children
      for (let index = children.length - 1; index >= 0; index -= 1) {
        stack.push(children[index])
      }
    }
  }

  return {
    roots,
    detached: questions.filter((_question, index) => !reachableIndexes.has(index)),
  }
}

/**
 * Serializes a forest in preorder. Any record not reached from a root is
 * appended in source order instead of being silently discarded.
 */
export function flattenQuestionForest<T extends FormQuestion>(forest: QuestionForest<T>): T[] {
  const result: T[] = []
  const visitedNodes = new Set<QuestionTreeNode<T>>()
  const stack = [...forest.roots].reverse()

  while (stack.length > 0) {
    const node = stack.pop()
    if (!node || visitedNodes.has(node)) continue

    visitedNodes.add(node)
    result.push(node.question)

    for (let branchIndex = node.branches.length - 1; branchIndex >= 0; branchIndex -= 1) {
      const children = node.branches[branchIndex].children
      for (let index = children.length - 1; index >= 0; index -= 1) {
        stack.push(children[index])
      }
    }
  }

  return [...result, ...forest.detached]
}

type NodeLocation<T extends FormQuestion> = {
  collection: QuestionTreeNode<T>[]
  index: number
  node: QuestionTreeNode<T>
}

function findNodeLocation<T extends FormQuestion>(
  forest: QuestionTreeNode<T>[],
  key: string,
): NodeLocation<T> | null {
  const visited = new Set<object>()
  const stack: Array<{ collection: QuestionTreeNode<T>[]; index: number }> = []

  for (let index = forest.length - 1; index >= 0; index -= 1) {
    stack.push({ collection: forest, index })
  }

  while (stack.length > 0) {
    const entry = stack.pop()
    if (!entry) continue

    const node = entry.collection[entry.index]
    if (!node || visited.has(node)) continue
    visited.add(node)

    if (node.question.key === key) return { ...entry, node }

    for (let branchIndex = node.branches.length - 1; branchIndex >= 0; branchIndex -= 1) {
      const children = node.branches[branchIndex].children
      for (let index = children.length - 1; index >= 0; index -= 1) {
        stack.push({ collection: children, index })
      }
    }
  }

  return null
}

export type QuestionMoveDirection = 'UP' | 'DOWN'

/** Moves a node, including its descendants, only inside its placement branch. */
export function moveQuestionWithinBranch(
  questions: readonly FormQuestion[],
  key: string,
  direction: QuestionMoveDirection,
): FormQuestion[] {
  const forest = buildQuestionForest(questions)
  const location = findNodeLocation(forest.roots, key)
  if (!location) return flattenQuestionForest(forest)

  const destinationIndex = direction === 'UP' ? location.index - 1 : location.index + 1
  const destination = location.collection[destinationIndex]

  if (!destination) return flattenQuestionForest(forest)

  const current = location.collection[location.index]
  location.collection[location.index] = destination
  location.collection[destinationIndex] = current

  return flattenQuestionForest(forest)
}

/** Lists a question and every record whose conditional ancestor chain reaches it. */
export function questionSubtreeKeys(questions: readonly FormQuestion[], key: string): Set<string> {
  if (!questions.some((question) => question.key === key)) return new Set()

  const removedKeys = new Set<string>([key])
  let changed = true

  while (changed) {
    changed = false
    for (const question of questions) {
      const parentKey = question.condition?.questionKey
      if (parentKey && removedKeys.has(parentKey) && !removedKeys.has(question.key)) {
        removedKeys.add(question.key)
        changed = true
      }
    }
  }

  return removedKeys
}

/** Removes the selected question and every question whose ancestor chain reaches it. */
export function removeQuestionSubtree(questions: readonly FormQuestion[], key: string): FormQuestion[] {
  const removedKeys = questionSubtreeKeys(questions, key)
  if (removedKeys.size === 0) return flattenQuestionForest(buildQuestionForest(questions))

  return flattenQuestionForest(buildQuestionForest(questions.filter((question) => !removedKeys.has(question.key))))
}

/** Adds a new root or conditional child without inheriting a stale condition. */
export function appendQuestionAtPlacement(
  questions: readonly FormQuestion[],
  question: FormQuestion,
  placement: QuestionPlacement,
): FormQuestion[] {
  const questionWithoutCondition = { ...question }
  delete questionWithoutCondition.condition
  const appended = placement.parentKey === null
    ? questionWithoutCondition
    : {
      ...questionWithoutCondition,
      condition: {
        questionKey: placement.parentKey,
        equals: placement.equals ?? '',
      },
    }

  return flattenQuestionForest(buildQuestionForest([...questions, appended]))
}

/** Returns a fresh internal key without mutating or renaming any existing question. */
export function nextQuestionKey(questions: readonly FormQuestion[]): string {
  let highest = BigInt(0)

  for (const question of questions) {
    const match = /^question-([1-9]\d*)$/.exec(question.key)
    if (match) highest = highest > BigInt(match[1]) ? highest : BigInt(match[1])
  }

  return `question-${highest + BigInt(1)}`
}
