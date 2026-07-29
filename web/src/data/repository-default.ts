import { httpProjectRepository } from './http-project-repository'

export const projectRepository = httpProjectRepository
export const projectId = 'project_default'

export function resetProjectRepositoryForTests(): void {
  // Production has no mutable fixture repository to reset.
}
