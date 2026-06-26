# AI OpenSCAD

[English](README.md)

[![GitHub 活跃度](https://img.shields.io/github/commit-activity/m/lich-wang/ai-openscad?label=activity)](https://github.com/lich-wang/ai-openscad/graphs/commit-activity)
[![贡献者](https://img.shields.io/github/contributors/lich-wang/ai-openscad)](https://github.com/lich-wang/ai-openscad/graphs/contributors)
[![许可证：AGPL v3](https://img.shields.io/badge/license-AGPL--3.0--only-blue.svg)](LICENSE)

AI OpenSCAD 是一个运行在浏览器里的 OpenSCAD 工作台：用自然语言需求生成
OpenSCAD 模型，在本地渲染草稿几何，支持视觉评审，并在用户确认迭代后导出
SCAD/STL 资产。

生产环境：https://ai.openscad.tech

## 项目文档

- [中文产品文档](docs/PRODUCT.zh-CN.md)
- [Product document](docs/PRODUCT.md)

## GitHub 活跃度

[![AI OpenSCAD activity](https://github-readme-activity-graph.vercel.app/graph?username=lich-wang&repo=ai-openscad&theme=github-compact&hide_border=true)](https://github.com/lich-wang/ai-openscad/graphs/commit-activity)

## 贡献者

[![贡献者](https://contrib.rocks/image?repo=lich-wang/ai-openscad)](https://github.com/lich-wang/ai-openscad/graphs/contributors)

## 快速开始

```bash
npm install
npm run dev
```

发布前运行本地检查：

```bash
npm test
npm run test:e2e
npm run build
```

## 许可证

AI OpenSCAD 使用 **GNU Affero General Public License v3.0 only
(AGPL-3.0-only)** 授权。如果你修改本项目并通过网络向用户提供服务，必须以同一
许可证开放对应源代码。
