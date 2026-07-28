# 本地项目管理系统

React、TypeScript 与 Vite 构建的本地项目管理 Web 应用。

## 环境要求

- Node.js 20.19+
- npm

## 常用命令

- `npm run dev`：启动开发服务器
- `npm run check`：运行代码检查、单元测试和生产构建
- `npm run test:e2e`：运行 Playwright 端到端测试

## React Router 安全范围

本项目是仅使用 `BrowserRouter` 的客户端 SPA，不使用 React Router 的
unstable RSC API。当前锁定 `react-router-dom@7.18.1`；`npm audit`
剩余的 RSC 专属公告不影响当前调用范围。待修复版本 `8.3.0` 发布后跟踪升级。
