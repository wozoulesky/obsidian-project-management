import { httpProjectRepository } from '../data/http-project-repository'
import { createMockProjectRepository } from '../data/mock-project-repository'
import type { ProjectRepository } from '../data/project-repository'

export function selectAppRepository(
  mode: string,
  fixtureFlag: string | boolean | undefined,
): ProjectRepository {
  return mode === 'e2e' && (fixtureFlag === 'true' || fixtureFlag === true)
    ? createMockProjectRepository()
    : httpProjectRepository
}
