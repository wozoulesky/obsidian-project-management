export type TestEnvironment = Readonly<{
  directory: string
  databasePath: string
  backupRoot: string
  cleanup(): Promise<void>
}>

export function createTestEnvironment(
  label: string,
): Promise<TestEnvironment>
