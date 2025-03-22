import fs from 'node:fs';

export default {
  "timeout": "60s",
  "typescript": {
    "rewritePaths": Object.fromEntries(
      fs.readdirSync('./packages')
        .map((name) => [ `packages/${name}/src/`, `packages/${name}/out/` ])
    ),
    "compile": false
  },
  "nodeArguments": [
    "--experimental-json-modules",
    "--disable-warning=ExperimentalWarning"
  ]
};

