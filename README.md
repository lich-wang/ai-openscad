# AI OpenSCAD

[中文文档](README.zh-CN.md)

[![GitHub activity](https://img.shields.io/github/commit-activity/m/lich-wang/ai-openscad?label=activity)](https://github.com/lich-wang/ai-openscad/graphs/commit-activity)
[![Contributors](https://img.shields.io/github/contributors/lich-wang/ai-openscad)](https://github.com/lich-wang/ai-openscad/graphs/contributors)
[![License: AGPL v3](https://img.shields.io/badge/license-AGPL--3.0--only-blue.svg)](LICENSE)

AI OpenSCAD is a browser workbench that turns natural-language requirements into
OpenSCAD models, renders draft geometry locally, supports visual review, and
exports SCAD/STL assets after user-confirmed iteration.

Production: https://ai.openscad.tech

## Project Docs

- [Product document](docs/PRODUCT.md)
- [中文产品文档](docs/PRODUCT.zh-CN.md)

## GitHub Activity

[![AI OpenSCAD activity](https://github-readme-activity-graph.vercel.app/graph?username=lich-wang&repo=ai-openscad&theme=github-compact&hide_border=true)](https://github.com/lich-wang/ai-openscad/graphs/commit-activity)

## Contributors

[![Contributors](https://contrib.rocks/image?repo=lich-wang/ai-openscad)](https://github.com/lich-wang/ai-openscad/graphs/contributors)

## Quick Start

Use Node.js 24 or newer.

```bash
npm install
npm run dev
```

Run local checks before release:

```bash
npm test
npm run test:e2e
npm run build
```

## License

AI OpenSCAD is licensed under **GNU Affero General Public License v3.0 only
(AGPL-3.0-only)**. If you modify and run this project for users over a network,
you must make the corresponding source code available under the same license.
