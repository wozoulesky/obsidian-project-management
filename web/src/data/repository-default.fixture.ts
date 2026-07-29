import { createMockProjectRepository } from './mock-project-repository'

export const projectRepository = createMockProjectRepository()
export const projectId = 'atlas'

export function resetProjectRepositoryForTests(): void {
  Object.assign(projectRepository, createMockProjectRepository())
}
