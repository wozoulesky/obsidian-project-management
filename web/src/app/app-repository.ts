import { httpProjectRepository } from '../data/http-project-repository'
import { createMockProjectRepository } from '../data/mock-project-repository'
import type { ProjectRepository } from '../data/project-repository'

export function selectAppRepository(
  useE2eFixtures: boolean,
): ProjectRepository {
  return useE2eFixtures
    ? createMockProjectRepository()
    : httpProjectRepository
}
