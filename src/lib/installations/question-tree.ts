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

export type QuestionBranchChoice = {
  value: string
  label: string
}

type ForestMetadata = {
  source: readonly FormQuestion[]
  nodeIndexes: WeakMap<object, number>
}

const forestMetadata = new WeakMap<object, ForestMetadata>()

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
 * connected to a root remain in the source metadata and are restored by
 * flattenQuestionForest, so the schema validator can still diagnose them.
 */
export function buildQuestionForest<T extends FormQuestion>(questions: readonly T[]): QuestionTreeNode<T>[] {
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
  const forest: QuestionTreeNode<T>[] = []

  questions.forEach((question, index) => {
    if (!question.condition) {
      forest.push(nodes[index])
      return
    }

    const parentIndex = uniqueKeyIndexes.get(question.condition.questionKey)
    if (parentIndex === undefined || parentIndex === index) return

    const branch = nodes[parentIndex].branches.find(({ value }) => value === question.condition?.equals)
    if (!branch) return
    branch.children.push(nodes[index])
  })

  const nodeIndexes = new WeakMap<object, number>()
  nodes.forEach((node, index) => nodeIndexes.set(node, index))
  forestMetadata.set(forest, { source: questions, nodeIndexes })

  return forest
}

/**
 * Serializes a forest in preorder. Any record not reached from a root is
 * appended in source order instead of being silently discarded.
 */
export function flattenQuestionForest<T extends FormQuestion>(forest: readonly QuestionTreeNode<T>[]): T[] {
  const metadata = forestMetadata.get(forest)
  const result: T[] = []
  const visitedNodes = new Set<object>()
  const visitedIndexes = new Set<number>()
  const stack = [...forest].reverse()

  while (stack.length > 0) {
    const node = stack.pop()
    if (!node || visitedNodes.has(node)) continue

    visitedNodes.add(node)
    result.push(node.question)

    const sourceIndex = metadata?.nodeIndexes.get(node)
    if (sourceIndex !== undefined) visitedIndexes.add(sourceIndex)

    for (let branchIndex = node.branches.length - 1; branchIndex >= 0; branchIndex -= 1) {
      const children = node.branches[branchIndex].children
      for (let index = children.length - 1; index >= 0; index -= 1) {
        stack.push(children[index])
      }
    }
  }

  if (metadata) {
    metadata.source.forEach((question, index) => {
      if (!visitedIndexes.has(index)) result.push(question as T)
    })
  }

  return result
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
export function moveQuestionWithinBranch<T extends FormQuestion>(
  questions: readonly T[],
  key: string,
  direction: QuestionMoveDirection,
): T[] {
  const forest = buildQuestionForest(questions)
  const location = findNodeLocation(forest, key)
  if (!location) return flattenQuestionForest(forest)

  const destinationIndex = direction === 'UP' ? location.index - 1 : location.index + 1
  const destination = location.collection[destinationIndex]

  if (!destination) return flattenQuestionForest(forest)

  const current = location.collection[location.index]
  location.collection[location.index] = destination
  location.collection[destinationIndex] = current

  return flattenQuestionForest(forest)
}

/** Removes the selected question and every question whose ancestor chain reaches it. */
export function removeQuestionSubtree<T extends FormQuestion>(questions: readonly T[], key: string): T[] {
  if (!questions.some((question) => question.key === key)) {
    return flattenQuestionForest(buildQuestionForest(questions))
  }

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

  return flattenQuestionForest(buildQuestionForest(questions.filter((question) => !removedKeys.has(question.key))))
}

/** Adds a new root or conditional child without inheriting a stale condition. */
export function appendQuestionAtPlacement<T extends FormQuestion>(
  questions: readonly T[],
  question: T,
  placement: QuestionPlacement,
): T[] {
  const questionWithoutCondition = Object.fromEntries(
    Object.entries(question).filter(([field]) => field !== 'condition'),
  ) as Omit<T, 'condition'>
  const appended = placement.parentKey === null
    ? questionWithoutCondition as T
    : {
      ...questionWithoutCondition,
      condition: {
        questionKey: placement.parentKey,
        equals: placement.equals ?? '',
      },
    } as T

  return flattenQuestionForest(buildQuestionForest([...questions, appended]))
}

/** Returns a fresh internal key without mutating or renaming any existing question. */
export function nextQuestionKey(questions: readonly FormQuestion[]): string {
  const highest = questions.reduce((currentHighest, question) => {
    const match = /^question-([1-9]\d*)$/.exec(question.key)
    return match ? Math.max(currentHighest, Number(match[1])) : currentHighest
  }, 0)

  return `question-${highest + 1}`
}
