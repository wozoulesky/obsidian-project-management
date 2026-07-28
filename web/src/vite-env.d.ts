/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FIXTURE_MODE?: 'large'
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
