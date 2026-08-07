#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = resolve(
  root,
  'stackchan/lib/visualizer_core/include/visualizer/generated_catalog.hpp',
);

function renderHeader(definitions) {
  const json = JSON.stringify(definitions);
  const unsafeDelimiter = json.includes(')SC_CATALOG"');
  if (unsafeDelimiter) {
    throw new Error('catalog contains the generated C++ raw-string delimiter');
  }
  const parameters = definitions.flatMap((definition) =>
    definition.parameters.map((parameter) => ({ generatorId: definition.id, ...parameter })),
  );
  const textures = definitions.flatMap((definition) =>
    (definition.textures ?? []).map((id) => ({ generatorId: definition.id, id })),
  );
  const generatorRows = definitions
    .map(
      (definition) =>
        `    {${JSON.stringify(definition.id)}, ${definition.version}, ${JSON.stringify(
          definition.category,
        )}, ${JSON.stringify(definition.costClass)}, ${definition.cost.passes}, ${definition.cost.relativeFill}, ${definition.cost.stateful}},`,
    )
    .join('\n');
  const parameterRows = parameters
    .map((parameter) => {
      const hasRange = parameter.min !== undefined || parameter.max !== undefined;
      const minimum = parameter.min ?? 0;
      const maximum = parameter.max ?? 0;
      const options = (parameter.options ?? []).join('|');
      return `    {${JSON.stringify(parameter.generatorId)}, ${JSON.stringify(
        parameter.id,
      )}, ${JSON.stringify(parameter.kind)}, ${minimum}, ${maximum}, ${hasRange}, ${parameter.modulatable}, ${JSON.stringify(options)}},`;
    })
    .join('\n');
  const textureRows = textures
    .map(
      (texture) => `    {${JSON.stringify(texture.generatorId)}, ${JSON.stringify(texture.id)}},`,
    )
    .join('\n');

  return `#pragma once

#include <cstddef>

// TypeScriptの正本をViteで読み込み、CoreS3とホストが同じカタログを返せる形へ変換する。
// clang-format off
namespace stackchan {
struct GeneratedGeneratorDefinition {
  const char* id;
  int version;
  const char* category;
  const char* costClass;
  int passes;
  double relativeFill;
  bool stateful;
};

struct GeneratedParameterDefinition {
  const char* generatorId;
  const char* id;
  const char* kind;
  double minimum;
  double maximum;
  bool hasRange;
  bool modulatable;
  const char* options;
};

struct GeneratedTextureDefinition {
  const char* generatorId;
  const char* id;
};

inline constexpr char kGeneratorCatalogJson[] = R"SC_CATALOG(${json})SC_CATALOG";
inline constexpr GeneratedGeneratorDefinition kGeneratorDefinitions[] = {
${generatorRows}
};
inline constexpr GeneratedParameterDefinition kParameterDefinitions[] = {
${parameterRows}
};
inline constexpr GeneratedTextureDefinition kTextureDefinitions[] = {
${textureRows}
};
inline constexpr std::size_t kGeneratorDefinitionCount =
    sizeof(kGeneratorDefinitions) / sizeof(kGeneratorDefinitions[0]);
inline constexpr std::size_t kParameterDefinitionCount =
    sizeof(kParameterDefinitions) / sizeof(kParameterDefinitions[0]);
inline constexpr std::size_t kTextureDefinitionCount =
    sizeof(kTextureDefinitions) / sizeof(kTextureDefinitions[0]);
} // namespace stackchan
// clang-format on
`;
}

async function loadDefinitions() {
  const server = await createServer({
    root,
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'silent',
  });
  try {
    const module = await server.ssrLoadModule('/src/synth/generators/index.ts');
    return module.inlineCatalog.all().map((entry) => entry.def);
  } finally {
    await server.close();
  }
}

const expected = renderHeader(await loadDefinitions());
const checksOnly = process.argv.includes('--check');
if (checksOnly) {
  let actual = '';
  try {
    actual = readFileSync(outputPath, 'utf8');
  } catch {
    // 欠落も陳腐化と同じ終了コードにまとめ、CI側の扱いを単純にする。
  }
  const isCurrent = actual === expected;
  if (!isCurrent) {
    throw new Error('generated_catalog.hpp is stale; run `just catalog-generate`');
  }
} else {
  writeFileSync(outputPath, expected);
  console.log(`generated ${outputPath}`);
}
