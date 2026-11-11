# D21 ownership ledger

Candidate inventory at `9f62358f895a789d516aa40b8d81439bd0f11471`.
Source is [architecture-policy.json](../../scripts/architecture-policy.json).
The feature below owns the first replacement needed for the exact edge.
D21's approved policy owner, expiry and removal task remain authoritative.
Retire each fingerprint with the verified boundary fix in its serialized slot.
Rows for manifests and wildcard exports remain until their final consumer moves.
The 184 records contain 69 distinct fingerprints. Different edges and rules
can share a statement fingerprint. The ledger uses the checker's full key of
rule, importer, target and fingerprint.

## Extraction order

| Slot | Owning feature | Records | Required change |
| --- | --- | ---: | --- |
| 1 | [001-workspace-foundation](../001-workspace-foundation/spec.md) | 2 | Publish identity and workspace test seams. R2 notebook deletion belongs here. |
| 2 | [002-text-pdf-ingestion-inspector](../002-text-pdf-ingestion-inspector/spec.md) | 5 | Publish the C-01 ingestion test/service interface. |
| 3 | [003-grounded-chat-citation-engine](../003-grounded-chat-citation-engine/spec.md) | 20 | Publish the grounded chat ports and D23 Gemini routing. |
| 4 | [006-source-guide-chat-control](../006-source-guide-chat-control/spec.md) | 18 | Publish structured generation and Guide hooks after 003. |
| 5 | [005-workspace-ui-comfort](../005-workspace-ui-comfort/spec.md) | 4 | Extract topic emoji behind its feature adapter after 003. |
| 6 | [009-multimodal-ingestion-sync](../009-multimodal-ingestion-sync/spec.md) | 46 | Integrate multimodal C-01 and Guide hooks after 002 and 006. |
| 7 | [007-notes-pinboard-lifecycle](../007-notes-pinboard-lifecycle/spec.md) | 9 | Move Note-source normalization and fixtures after the 003 and 009 seams. |
| 8 | [008-studio-text-reports](../008-studio-text-reports/spec.md) | 30 | Publish Reports and shared Studio lifecycle ports after 003 and 006. |
| 9 | [011-studio-mindmaps-data-tables](../011-studio-mindmaps-data-tables/spec.md) | 16 | Wire Maps/Tables against structured generation and Studio lifecycle ports. |
| 10 | [010-code-execution-sandbox](../010-code-execution-sandbox/spec.md) | 10 | Extract the code execution test/runtime seam after 003; agree on timing evidence with 012. |
| 11 | [012-long-context-latency-scaling](../012-long-context-latency-scaling/spec.md) | 2 | Retire scale harness app imports after 010 and profile integration. |
| 12 | [013-v2-persistence-postgres](../013-v2-persistence-postgres/spec.md) | 8 | Migrate legacy v2 runtime and restart fixtures after consumer ports land. |
| 13 | [004-ui-skeleton-quality-gates](../004-ui-skeleton-quality-gates/spec.md) | 14 | Retire remaining shared exports, test-host and manifest edges after producer extraction. |

## R2 workflow ownership

| Route and responsibility | Application owner | Persistence and behavior to preserve |
| --- | --- | --- |
| `GET /api/notebooks` parses sort and serializes overview | 001 notebook overview use case coordinates the owner-scoped list, Ready counts and decoration through 005 preference ports | DB owns list and count queries. Preserve ordering, per-user pin state and Ready counts. |
| `GET /api/notebooks/:id` serializes detail and quota | 001 notebook detail use case coordinates authorized read, quota and 005 decoration | DB owns quota and ownership reads. Preserve v1/v2 response shapes. |
| `POST /api/notebooks` parses input and idempotency key; `PATCH /api/notebooks/:id` parses title | 001 create/rename use cases coordinate v2 decoration with 005 | DB owns idempotent create and atomic quota reservation. Preserve replay and rename behavior. |
| `DELETE /api/notebooks/:id` returns 202 and deletion ID | 001 notebook deletion use case coordinates durable deletion, 003 chat abort, v2 cancellation and notification | DB atomically enqueues cleanup with deletion. Preserve current ordering, failure and restart behavior, D16 placement and publication fencing. |
| `DELETE /api/notebooks/:id/sources/:sourceId/error` maps 204 | 002 source-error workflow coordinates dismissal and 005 workspace modification | DB owns authorization and dismissal. Preserve modified time and scoped state. |
| Icon and opened routes parse inputs and map HTTP statuses | 005 workspace preference use cases coordinate 001 ownership, sync and mutation | DB and preference adapters own storage. Preserve owner scoping and last-opened ordering. |
| Quota and deletion-status reads | 001 authorized single repository reads can remain in transport | These handlers perform one scoped query and coordinate no writes or follow-up effects. |

The application composition root is `apps/api/src/app.ts`, with v2 adapters
wired through `apps/api/src/v2/runtime.ts`. Notebook persistence stays in
`packages/db/src/notebooks.ts`. Before R2 extraction, characterize overview and
deletion without HTTP objects. Retain workspace, preference and database
integration tests, including cascade and restart. R2 ownership has no separate
import fingerprint. T035/T036 remain open for the actual extractions.

## Exact fingerprints

### Slot 1 · 001-workspace-foundation

| Fingerprint | Rule | Importer | Target |
| --- | --- | --- | --- |
| `06c0373ccc8797437af8e5f8654ce55af2bf3b0d2d6f519429957ae4267ad806` | `no-cross-app` | `apps/web/test/e2e-server.ts` | `apps/api/src/auth/identity.ts` |
| `06c0373ccc8797437af8e5f8654ce55af2bf3b0d2d6f519429957ae4267ad806` | `public-entrypoint` | `apps/web/test/e2e-server.ts` | `apps/api/src/auth/identity.ts` |

### Slot 2 · 002-text-pdf-ingestion-inspector

| Fingerprint | Rule | Importer | Target |
| --- | --- | --- | --- |
| `e81b69ab0355e80a8e3b7a19223c59bc6b97ab5820eaf76b50897462ec63f0eb` | `no-cross-app` | `apps/api/test/sources.test.ts` | `apps/worker/src/index.ts` |
| `9292a65b30f336bd633e63631c3d915b959ef4af2296d95c649b6fa13dc3d315` | `no-cross-app` | `apps/web/test/e2e-v3-doubles.ts` | `apps/worker/src/ingestion/pipeline.ts` |
| `9292a65b30f336bd633e63631c3d915b959ef4af2296d95c649b6fa13dc3d315` | `public-entrypoint` | `apps/web/test/e2e-v3-doubles.ts` | `apps/worker/src/ingestion/pipeline.ts` |
| `205f28416ce709ab2fe8df9e26160de4a724132f516f75ff9d8a131182045938` | `no-shared-to-app` | `packages/evals/src/runner.ts` | `apps/worker/src/ingestion/pipeline.ts` |
| `205f28416ce709ab2fe8df9e26160de4a724132f516f75ff9d8a131182045938` | `public-entrypoint` | `packages/evals/src/runner.ts` | `apps/worker/src/ingestion/pipeline.ts` |

### Slot 3 · 003-grounded-chat-citation-engine

| Fingerprint | Rule | Importer | Target |
| --- | --- | --- | --- |
| `962923f7f8f3c8d67fab9886a804eb8476c2e6fe33081faa2783e6e2df500201` | `no-cross-app` | `apps/web/test/e2e-server.ts` | `apps/api/src/chat/draft.ts` |
| `962923f7f8f3c8d67fab9886a804eb8476c2e6fe33081faa2783e6e2df500201` | `public-entrypoint` | `apps/web/test/e2e-server.ts` | `apps/api/src/chat/draft.ts` |
| `5be677cff848674f2e83f242471f609f71ff9a1b070149e0d73057dd8988525f` | `no-cross-app` | `apps/web/test/e2e-server.ts` | `apps/api/src/chat/model.ts` |
| `5be677cff848674f2e83f242471f609f71ff9a1b070149e0d73057dd8988525f` | `public-entrypoint` | `apps/web/test/e2e-server.ts` | `apps/api/src/chat/model.ts` |
| `098331ccad286da8f7f9a9e68d639b8cbb3f24bb59680e091b0dcbdd24bdc13f` | `no-cross-app` | `apps/web/test/e2e-server.ts` | `apps/api/src/chat/service.ts` |
| `098331ccad286da8f7f9a9e68d639b8cbb3f24bb59680e091b0dcbdd24bdc13f` | `public-entrypoint` | `apps/web/test/e2e-server.ts` | `apps/api/src/chat/service.ts` |
| `dc2ddf7775911089158b7d48c214ce86530501cafd8f96fbfdeaeb696c769650` | `no-shared-to-app` | `packages/evals/src/cli.ts` | `apps/api/src/chat/model.ts` |
| `dc2ddf7775911089158b7d48c214ce86530501cafd8f96fbfdeaeb696c769650` | `public-entrypoint` | `packages/evals/src/cli.ts` | `apps/api/src/chat/model.ts` |
| `962923f7f8f3c8d67fab9886a804eb8476c2e6fe33081faa2783e6e2df500201` | `no-shared-to-app` | `packages/evals/src/deterministic-models.ts` | `apps/api/src/chat/draft.ts` |
| `962923f7f8f3c8d67fab9886a804eb8476c2e6fe33081faa2783e6e2df500201` | `public-entrypoint` | `packages/evals/src/deterministic-models.ts` | `apps/api/src/chat/draft.ts` |
| `5be677cff848674f2e83f242471f609f71ff9a1b070149e0d73057dd8988525f` | `no-shared-to-app` | `packages/evals/src/deterministic-models.ts` | `apps/api/src/chat/model.ts` |
| `5be677cff848674f2e83f242471f609f71ff9a1b070149e0d73057dd8988525f` | `public-entrypoint` | `packages/evals/src/deterministic-models.ts` | `apps/api/src/chat/model.ts` |
| `cb01a96e96f1b33cc0bfb4f4dbc1dae24acb58a1eec5f0fd3e2ccc0e5e7ff39c` | `no-shared-to-app` | `packages/evals/src/runner.ts` | `apps/api/src/chat/model.ts` |
| `cb01a96e96f1b33cc0bfb4f4dbc1dae24acb58a1eec5f0fd3e2ccc0e5e7ff39c` | `public-entrypoint` | `packages/evals/src/runner.ts` | `apps/api/src/chat/model.ts` |
| `80b6ff669c32686dda2919f67ad0ff1d5366a980dabf2d9ce666f3e69000f0dd` | `no-shared-to-app` | `packages/evals/src/runner.ts` | `apps/api/src/chat/service.ts` |
| `80b6ff669c32686dda2919f67ad0ff1d5366a980dabf2d9ce666f3e69000f0dd` | `public-entrypoint` | `packages/evals/src/runner.ts` | `apps/api/src/chat/service.ts` |
| `8302e9d235c448aac3e0268701fb8c73f3b32761302879ec79bd42ad11e2a19e` | `no-shared-to-app` | `packages/evals/src/runner.ts` | `apps/api/src/chat/verifier.ts` |
| `8302e9d235c448aac3e0268701fb8c73f3b32761302879ec79bd42ad11e2a19e` | `public-entrypoint` | `packages/evals/src/runner.ts` | `apps/api/src/chat/verifier.ts` |
| `7308b3ac7ddbf318dd9defda71324c3feac7593054d5f9e4ea05d8e0bd425dbe` | `no-shared-to-app` | `packages/evals/test/release-v1.integration.test.ts` | `apps/api/src/chat/service.ts` |
| `7308b3ac7ddbf318dd9defda71324c3feac7593054d5f9e4ea05d8e0bd425dbe` | `public-entrypoint` | `packages/evals/test/release-v1.integration.test.ts` | `apps/api/src/chat/service.ts` |

### Slot 4 · 006-source-guide-chat-control

| Fingerprint | Rule | Importer | Target |
| --- | --- | --- | --- |
| `538186f4f760fe6112b21af47608e22064ecc4b8214c51c2bfcb1abc5fc36c8b` | `no-cross-app` | `apps/api/src/server.ts` | `apps/worker/src/package-v2-2-gemini.ts` |
| `538186f4f760fe6112b21af47608e22064ecc4b8214c51c2bfcb1abc5fc36c8b` | `public-entrypoint` | `apps/api/src/server.ts` | `apps/worker/src/package-v2-2-gemini.ts` |
| `78c4c47b540062ef1b3d1c761c02cf060f6009c0172d7a72459e0227dab82607` | `no-cross-app` | `apps/api/src/server.ts` | `apps/worker/src/package-v2-2.ts` |
| `78c4c47b540062ef1b3d1c761c02cf060f6009c0172d7a72459e0227dab82607` | `public-entrypoint` | `apps/api/src/server.ts` | `apps/worker/src/package-v2-2.ts` |
| `78c4c47b540062ef1b3d1c761c02cf060f6009c0172d7a72459e0227dab82607` | `no-cross-app` | `apps/api/src/v2/runtime.ts` | `apps/worker/src/package-v2-2.ts` |
| `78c4c47b540062ef1b3d1c761c02cf060f6009c0172d7a72459e0227dab82607` | `public-entrypoint` | `apps/api/src/v2/runtime.ts` | `apps/worker/src/package-v2-2.ts` |
| `0e937371467682a791acae981e2db51aa84e5a7039e7ecf96daa554793287134` | `no-cross-app` | `apps/api/src/v2/runtime.ts` | `apps/worker/src/ready-hooks.ts` |
| `0e937371467682a791acae981e2db51aa84e5a7039e7ecf96daa554793287134` | `public-entrypoint` | `apps/api/src/v2/runtime.ts` | `apps/worker/src/ready-hooks.ts` |
| `5f10511d920694a723569be32ccb67f6be5ae811df288198f555a0635eb3dc6f` | `no-cross-app` | `apps/api/test/package-v2-2-runtime.test.ts` | `apps/worker/src/package-v2-2-gemini.ts` |
| `5f10511d920694a723569be32ccb67f6be5ae811df288198f555a0635eb3dc6f` | `public-entrypoint` | `apps/api/test/package-v2-2-runtime.test.ts` | `apps/worker/src/package-v2-2-gemini.ts` |
| `78c4c47b540062ef1b3d1c761c02cf060f6009c0172d7a72459e0227dab82607` | `no-cross-app` | `apps/api/test/source-guide-sync.test.ts` | `apps/worker/src/package-v2-2.ts` |
| `78c4c47b540062ef1b3d1c761c02cf060f6009c0172d7a72459e0227dab82607` | `public-entrypoint` | `apps/api/test/source-guide-sync.test.ts` | `apps/worker/src/package-v2-2.ts` |
| `e1b6601242aaa4f5d2689bc60584a4478d36fdc6df560cb16fdfcca6474a1204` | `no-shared-to-app` | `packages/evals/src/source-guide-gate.ts` | `apps/worker/src/package-v2-2-gemini.ts` |
| `e1b6601242aaa4f5d2689bc60584a4478d36fdc6df560cb16fdfcca6474a1204` | `public-entrypoint` | `packages/evals/src/source-guide-gate.ts` | `apps/worker/src/package-v2-2-gemini.ts` |
| `4b8703a033943cea29c8ddcd69378a7b9bf85a9fe7d21aa8310af9cfb473a720` | `no-shared-to-app` | `packages/evals/src/source-guide-gate.ts` | `apps/worker/src/package-v2-2.ts` |
| `4b8703a033943cea29c8ddcd69378a7b9bf85a9fe7d21aa8310af9cfb473a720` | `public-entrypoint` | `packages/evals/src/source-guide-gate.ts` | `apps/worker/src/package-v2-2.ts` |
| `78c4c47b540062ef1b3d1c761c02cf060f6009c0172d7a72459e0227dab82607` | `no-shared-to-app` | `packages/evals/test/source-guide-gate.eval.test.ts` | `apps/worker/src/package-v2-2.ts` |
| `78c4c47b540062ef1b3d1c761c02cf060f6009c0172d7a72459e0227dab82607` | `public-entrypoint` | `packages/evals/test/source-guide-gate.eval.test.ts` | `apps/worker/src/package-v2-2.ts` |

### Slot 5 · 005-workspace-ui-comfort

| Fingerprint | Rule | Importer | Target |
| --- | --- | --- | --- |
| `a132b86e8b91b30b603705823967569964951fea64583647d6b13192d1f0d7a4` | `no-cross-app` | `apps/api/src/server.ts` | `apps/worker/src/ingestion/topic-emoji.ts` |
| `a132b86e8b91b30b603705823967569964951fea64583647d6b13192d1f0d7a4` | `public-entrypoint` | `apps/api/src/server.ts` | `apps/worker/src/ingestion/topic-emoji.ts` |
| `a4b7a26645e4f01e09c41cfee206d5da15845df3aae216b294cfdb4b95319a7e` | `no-cross-app` | `apps/api/src/v2/runtime.ts` | `apps/worker/src/ingestion/topic-emoji.ts` |
| `a4b7a26645e4f01e09c41cfee206d5da15845df3aae216b294cfdb4b95319a7e` | `public-entrypoint` | `apps/api/src/v2/runtime.ts` | `apps/worker/src/ingestion/topic-emoji.ts` |

### Slot 6 · 009-multimodal-ingestion-sync

| Fingerprint | Rule | Importer | Target |
| --- | --- | --- | --- |
| `e81b69ab0355e80a8e3b7a19223c59bc6b97ab5820eaf76b50897462ec63f0eb` | `no-cross-app` | `apps/api/test/media-content.test.ts` | `apps/worker/src/index.ts` |
| `36fd5b30fed9697f30d762df9259087a6bf89d27b6920a5300d1227723da0a52` | `no-cross-app` | `apps/api/test/media-content.test.ts` | `apps/worker/src/ingestion/media.ts` |
| `36fd5b30fed9697f30d762df9259087a6bf89d27b6920a5300d1227723da0a52` | `public-entrypoint` | `apps/api/test/media-content.test.ts` | `apps/worker/src/ingestion/media.ts` |
| `e81b69ab0355e80a8e3b7a19223c59bc6b97ab5820eaf76b50897462ec63f0eb` | `no-cross-app` | `apps/api/test/office-import.test.ts` | `apps/worker/src/index.ts` |
| `67048b0c94b5fa4718b8beea4f531b47484e4fc0d997e5bb41d21f712d9e293e` | `no-cross-app` | `apps/api/test/office-import.test.ts` | `apps/worker/src/ingestion/drive.ts` |
| `67048b0c94b5fa4718b8beea4f531b47484e4fc0d997e5bb41d21f712d9e293e` | `public-entrypoint` | `apps/api/test/office-import.test.ts` | `apps/worker/src/ingestion/drive.ts` |
| `20e1bae9345967e7c7752af09f1eceb1bd6a5382f649f389725ec461457fa52a` | `no-cross-app` | `apps/api/test/office-import.test.ts` | `apps/worker/src/ingestion/office.ts` |
| `20e1bae9345967e7c7752af09f1eceb1bd6a5382f649f389725ec461457fa52a` | `public-entrypoint` | `apps/api/test/office-import.test.ts` | `apps/worker/src/ingestion/office.ts` |
| `e81b69ab0355e80a8e3b7a19223c59bc6b97ab5820eaf76b50897462ec63f0eb` | `no-cross-app` | `apps/api/test/source-lifecycle.test.ts` | `apps/worker/src/index.ts` |
| `cf7b9ef2d809b71a90119fa7ea3d6c157083867cec453b833b93d0f974c17f81` | `no-cross-app` | `apps/api/test/source-lifecycle.test.ts` | `apps/worker/src/ingestion/web.ts` |
| `cf7b9ef2d809b71a90119fa7ea3d6c157083867cec453b833b93d0f974c17f81` | `public-entrypoint` | `apps/api/test/source-lifecycle.test.ts` | `apps/worker/src/ingestion/web.ts` |
| `e81b69ab0355e80a8e3b7a19223c59bc6b97ab5820eaf76b50897462ec63f0eb` | `no-cross-app` | `apps/api/test/source-sync.test.ts` | `apps/worker/src/index.ts` |
| `cf7b9ef2d809b71a90119fa7ea3d6c157083867cec453b833b93d0f974c17f81` | `no-cross-app` | `apps/api/test/source-sync.test.ts` | `apps/worker/src/ingestion/web.ts` |
| `cf7b9ef2d809b71a90119fa7ea3d6c157083867cec453b833b93d0f974c17f81` | `public-entrypoint` | `apps/api/test/source-sync.test.ts` | `apps/worker/src/ingestion/web.ts` |
| `e81b69ab0355e80a8e3b7a19223c59bc6b97ab5820eaf76b50897462ec63f0eb` | `no-cross-app` | `apps/api/test/video-player.test.ts` | `apps/worker/src/index.ts` |
| `e18be17309fc0bc780dac3b1a46a3a6213c69c8219c29784dda779717c7dc93f` | `no-cross-app` | `apps/api/test/video-player.test.ts` | `apps/worker/src/ingestion/media.ts` |
| `e18be17309fc0bc780dac3b1a46a3a6213c69c8219c29784dda779717c7dc93f` | `public-entrypoint` | `apps/api/test/video-player.test.ts` | `apps/worker/src/ingestion/media.ts` |
| `a655930384a2204120202cb2c15c0f18faeec346990e01036720ab8eca97062f` | `no-cross-app` | `apps/api/test/video-player.test.ts` | `apps/worker/src/ingestion/web.ts` |
| `a655930384a2204120202cb2c15c0f18faeec346990e01036720ab8eca97062f` | `public-entrypoint` | `apps/api/test/video-player.test.ts` | `apps/worker/src/ingestion/web.ts` |
| `e81b69ab0355e80a8e3b7a19223c59bc6b97ab5820eaf76b50897462ec63f0eb` | `no-cross-app` | `apps/api/test/web-import.test.ts` | `apps/worker/src/index.ts` |
| `69952e9dcbb01b360ebb55da8e67ca688e547f3378967a45cb313acbe19b7644` | `no-cross-app` | `apps/api/test/web-import.test.ts` | `apps/worker/src/ingestion/web.ts` |
| `69952e9dcbb01b360ebb55da8e67ca688e547f3378967a45cb313acbe19b7644` | `public-entrypoint` | `apps/api/test/web-import.test.ts` | `apps/worker/src/ingestion/web.ts` |
| `58cc6935613fa8de1123e0d4537d4a0f65868470872e9989b61f72055d0b2d6e` | `no-cross-app` | `apps/web/test/e2e-v3-doubles.ts` | `apps/api/src/routes/connections.ts` |
| `58cc6935613fa8de1123e0d4537d4a0f65868470872e9989b61f72055d0b2d6e` | `public-entrypoint` | `apps/web/test/e2e-v3-doubles.ts` | `apps/api/src/routes/connections.ts` |
| `67048b0c94b5fa4718b8beea4f531b47484e4fc0d997e5bb41d21f712d9e293e` | `no-cross-app` | `apps/web/test/e2e-v3-doubles.ts` | `apps/worker/src/ingestion/drive.ts` |
| `67048b0c94b5fa4718b8beea4f531b47484e4fc0d997e5bb41d21f712d9e293e` | `public-entrypoint` | `apps/web/test/e2e-v3-doubles.ts` | `apps/worker/src/ingestion/drive.ts` |
| `4c576642a9e47628b152cf0d1fdeb4989f9318b35af6bc3ccdb24e004e1dd160` | `no-cross-app` | `apps/web/test/e2e-v3-doubles.ts` | `apps/worker/src/ingestion/media.ts` |
| `4c576642a9e47628b152cf0d1fdeb4989f9318b35af6bc3ccdb24e004e1dd160` | `public-entrypoint` | `apps/web/test/e2e-v3-doubles.ts` | `apps/worker/src/ingestion/media.ts` |
| `20e1bae9345967e7c7752af09f1eceb1bd6a5382f649f389725ec461457fa52a` | `no-cross-app` | `apps/web/test/e2e-v3-doubles.ts` | `apps/worker/src/ingestion/office.ts` |
| `20e1bae9345967e7c7752af09f1eceb1bd6a5382f649f389725ec461457fa52a` | `public-entrypoint` | `apps/web/test/e2e-v3-doubles.ts` | `apps/worker/src/ingestion/office.ts` |
| `de1c87ac0c8d7c925ce05c5e145031eb048234bb5a1405d1e8a3cbfb9c17f84d` | `no-cross-app` | `apps/web/test/e2e-v3-doubles.ts` | `apps/worker/src/ingestion/screening.ts` |
| `de1c87ac0c8d7c925ce05c5e145031eb048234bb5a1405d1e8a3cbfb9c17f84d` | `public-entrypoint` | `apps/web/test/e2e-v3-doubles.ts` | `apps/worker/src/ingestion/screening.ts` |
| `cf7b9ef2d809b71a90119fa7ea3d6c157083867cec453b833b93d0f974c17f81` | `no-cross-app` | `apps/web/test/e2e-v3-doubles.ts` | `apps/worker/src/ingestion/web.ts` |
| `cf7b9ef2d809b71a90119fa7ea3d6c157083867cec453b833b93d0f974c17f81` | `public-entrypoint` | `apps/web/test/e2e-v3-doubles.ts` | `apps/worker/src/ingestion/web.ts` |
| `80b6ff669c32686dda2919f67ad0ff1d5366a980dabf2d9ce666f3e69000f0dd` | `no-shared-to-app` | `packages/evals/test/multimodal-deterministic.eval.test.ts` | `apps/api/src/chat/service.ts` |
| `80b6ff669c32686dda2919f67ad0ff1d5366a980dabf2d9ce666f3e69000f0dd` | `public-entrypoint` | `packages/evals/test/multimodal-deterministic.eval.test.ts` | `apps/api/src/chat/service.ts` |
| `36fd5b30fed9697f30d762df9259087a6bf89d27b6920a5300d1227723da0a52` | `no-shared-to-app` | `packages/evals/test/multimodal-deterministic.eval.test.ts` | `apps/worker/src/ingestion/media.ts` |
| `36fd5b30fed9697f30d762df9259087a6bf89d27b6920a5300d1227723da0a52` | `public-entrypoint` | `packages/evals/test/multimodal-deterministic.eval.test.ts` | `apps/worker/src/ingestion/media.ts` |
| `20e1bae9345967e7c7752af09f1eceb1bd6a5382f649f389725ec461457fa52a` | `no-shared-to-app` | `packages/evals/test/multimodal-deterministic.eval.test.ts` | `apps/worker/src/ingestion/office.ts` |
| `20e1bae9345967e7c7752af09f1eceb1bd6a5382f649f389725ec461457fa52a` | `public-entrypoint` | `packages/evals/test/multimodal-deterministic.eval.test.ts` | `apps/worker/src/ingestion/office.ts` |
| `98c6ed7e16b8be866d834a3357fb788d6dd2bd929915d4506054d45bf7b21ba7` | `no-shared-to-app` | `packages/evals/test/multimodal-deterministic.eval.test.ts` | `apps/worker/src/ingestion/pipeline.ts` |
| `98c6ed7e16b8be866d834a3357fb788d6dd2bd929915d4506054d45bf7b21ba7` | `public-entrypoint` | `packages/evals/test/multimodal-deterministic.eval.test.ts` | `apps/worker/src/ingestion/pipeline.ts` |
| `591e4772ad1a16e21c0ad074c9f8d924ef3c20925cdd35f5a6bb29b576538012` | `no-shared-to-app` | `packages/evals/test/multimodal-deterministic.eval.test.ts` | `apps/worker/src/ingestion/sync.ts` |
| `591e4772ad1a16e21c0ad074c9f8d924ef3c20925cdd35f5a6bb29b576538012` | `public-entrypoint` | `packages/evals/test/multimodal-deterministic.eval.test.ts` | `apps/worker/src/ingestion/sync.ts` |
| `cf7b9ef2d809b71a90119fa7ea3d6c157083867cec453b833b93d0f974c17f81` | `no-shared-to-app` | `packages/evals/test/multimodal-deterministic.eval.test.ts` | `apps/worker/src/ingestion/web.ts` |
| `cf7b9ef2d809b71a90119fa7ea3d6c157083867cec453b833b93d0f974c17f81` | `public-entrypoint` | `packages/evals/test/multimodal-deterministic.eval.test.ts` | `apps/worker/src/ingestion/web.ts` |

### Slot 7 · 007-notes-pinboard-lifecycle

| Fingerprint | Rule | Importer | Target |
| --- | --- | --- | --- |
| `eab5b64b622ab9b8ba9539f141d6a8d9fc3a9d3611a173fcb1d6d7922fcfe3dc` | `no-cross-app` | `apps/api/src/notes/note-sources.ts` | `apps/worker/src/ingestion/note-markdown.ts` |
| `eab5b64b622ab9b8ba9539f141d6a8d9fc3a9d3611a173fcb1d6d7922fcfe3dc` | `public-entrypoint` | `apps/api/src/notes/note-sources.ts` | `apps/worker/src/ingestion/note-markdown.ts` |
| `e81b69ab0355e80a8e3b7a19223c59bc6b97ab5820eaf76b50897462ec63f0eb` | `no-cross-app` | `apps/api/test/notes-pg-support.ts` | `apps/worker/src/index.ts` |
| `cb01a96e96f1b33cc0bfb4f4dbc1dae24acb58a1eec5f0fd3e2ccc0e5e7ff39c` | `no-shared-to-app` | `packages/evals/test/notes-roundtrip.eval.test.ts` | `apps/api/src/chat/model.ts` |
| `cb01a96e96f1b33cc0bfb4f4dbc1dae24acb58a1eec5f0fd3e2ccc0e5e7ff39c` | `public-entrypoint` | `packages/evals/test/notes-roundtrip.eval.test.ts` | `apps/api/src/chat/model.ts` |
| `80b6ff669c32686dda2919f67ad0ff1d5366a980dabf2d9ce666f3e69000f0dd` | `no-shared-to-app` | `packages/evals/test/notes-roundtrip.eval.test.ts` | `apps/api/src/chat/service.ts` |
| `80b6ff669c32686dda2919f67ad0ff1d5366a980dabf2d9ce666f3e69000f0dd` | `public-entrypoint` | `packages/evals/test/notes-roundtrip.eval.test.ts` | `apps/api/src/chat/service.ts` |
| `733244402e20ac638ab522468abf32a3729880fd4d63607f82533f0b1d9a7389` | `no-shared-to-app` | `packages/evals/test/notes-roundtrip.eval.test.ts` | `apps/api/src/notes/note-sources.ts` |
| `733244402e20ac638ab522468abf32a3729880fd4d63607f82533f0b1d9a7389` | `public-entrypoint` | `packages/evals/test/notes-roundtrip.eval.test.ts` | `apps/api/src/notes/note-sources.ts` |

### Slot 8 · 008-studio-text-reports

| Fingerprint | Rule | Importer | Target |
| --- | --- | --- | --- |
| `11430cd1ee94d441ec10422e003a3b117b675f63be5c3622834684e3f5d64788` | `no-cross-app` | `apps/api/src/server.ts` | `apps/worker/src/studio/reports/vertex-model.ts` |
| `11430cd1ee94d441ec10422e003a3b117b675f63be5c3622834684e3f5d64788` | `public-entrypoint` | `apps/api/src/server.ts` | `apps/worker/src/studio/reports/vertex-model.ts` |
| `c56a928151ff641a2c25c02b10504100ffd9276280e5278a422605d9c064094e` | `no-cross-app` | `apps/api/src/v2/runtime.ts` | `apps/worker/src/studio/dispatcher.ts` |
| `c56a928151ff641a2c25c02b10504100ffd9276280e5278a422605d9c064094e` | `public-entrypoint` | `apps/api/src/v2/runtime.ts` | `apps/worker/src/studio/dispatcher.ts` |
| `9d6b4ebbde9ee2faf363d9d792f2073737c330788b0156bb0940b8eb978e9c0e` | `no-cross-app` | `apps/api/src/v2/runtime.ts` | `apps/worker/src/studio/registry.ts` |
| `9d6b4ebbde9ee2faf363d9d792f2073737c330788b0156bb0940b8eb978e9c0e` | `public-entrypoint` | `apps/api/src/v2/runtime.ts` | `apps/worker/src/studio/registry.ts` |
| `2c57b772576d2de9f6511da8775541b8f3fd8d9c124d77ae627a011b65489921` | `no-cross-app` | `apps/api/src/v2/runtime.ts` | `apps/worker/src/studio/reports/model.ts` |
| `2c57b772576d2de9f6511da8775541b8f3fd8d9c124d77ae627a011b65489921` | `public-entrypoint` | `apps/api/src/v2/runtime.ts` | `apps/worker/src/studio/reports/model.ts` |
| `739adcb1e5dde7613541dbf249c7488ab965a6f1a464ce6940f2601aad6bc2f7` | `no-cross-app` | `apps/api/src/v2/runtime.ts` | `apps/worker/src/studio/reports/suggestions.ts` |
| `739adcb1e5dde7613541dbf249c7488ab965a6f1a464ce6940f2601aad6bc2f7` | `public-entrypoint` | `apps/api/src/v2/runtime.ts` | `apps/worker/src/studio/reports/suggestions.ts` |
| `2cf71603da16d5587b0b7b891f350aaf604e0c9995e7bcff887561ae4e78055a` | `no-cross-app` | `apps/api/src/v2/runtime.ts` | `apps/worker/src/studio/runner.ts` |
| `2cf71603da16d5587b0b7b891f350aaf604e0c9995e7bcff887561ae4e78055a` | `public-entrypoint` | `apps/api/src/v2/runtime.ts` | `apps/worker/src/studio/runner.ts` |
| `9eebe59ca42fa1bee64987ee1030a5c4491179a551ddfdbcdeb8f81facb96feb` | `no-cross-app` | `apps/api/test/studio-runtime.integration.test.ts` | `apps/worker/src/studio/reports/deterministic-model.ts` |
| `9eebe59ca42fa1bee64987ee1030a5c4491179a551ddfdbcdeb8f81facb96feb` | `public-entrypoint` | `apps/api/test/studio-runtime.integration.test.ts` | `apps/worker/src/studio/reports/deterministic-model.ts` |
| `6011e91b616c54a2a5fecd5917b1e85dedba76e0366d1e4b099392d07e80e9b2` | `no-cross-app` | `apps/api/test/studio-runtime.integration.test.ts` | `apps/worker/src/studio/reports/model.ts` |
| `6011e91b616c54a2a5fecd5917b1e85dedba76e0366d1e4b099392d07e80e9b2` | `public-entrypoint` | `apps/api/test/studio-runtime.integration.test.ts` | `apps/worker/src/studio/reports/model.ts` |
| `9dbacf6be1ca2a3623ca17242887a6e1fa1f08224eadb1101a081eca7af9dc30` | `no-cross-app` | `apps/api/test/studio-runtime.integration.test.ts` | `apps/worker/src/studio/reports/vertex-model.ts` |
| `9dbacf6be1ca2a3623ca17242887a6e1fa1f08224eadb1101a081eca7af9dc30` | `public-entrypoint` | `apps/api/test/studio-runtime.integration.test.ts` | `apps/worker/src/studio/reports/vertex-model.ts` |
| `9eebe59ca42fa1bee64987ee1030a5c4491179a551ddfdbcdeb8f81facb96feb` | `no-shared-to-app` | `packages/evals/src/studio-gate.ts` | `apps/worker/src/studio/reports/deterministic-model.ts` |
| `9eebe59ca42fa1bee64987ee1030a5c4491179a551ddfdbcdeb8f81facb96feb` | `public-entrypoint` | `packages/evals/src/studio-gate.ts` | `apps/worker/src/studio/reports/deterministic-model.ts` |
| `7ca4197fee24d9066803d9250349f615f7440c211bbb42565d006b090029aeef` | `no-shared-to-app` | `packages/evals/src/studio-gate.ts` | `apps/worker/src/studio/reports/model.ts` |
| `7ca4197fee24d9066803d9250349f615f7440c211bbb42565d006b090029aeef` | `public-entrypoint` | `packages/evals/src/studio-gate.ts` | `apps/worker/src/studio/reports/model.ts` |
| `f97ef8aa3005fe75d381eed1192fe98d737da62708e9a5e79563e9146c613178` | `no-shared-to-app` | `packages/evals/src/studio-gate.ts` | `apps/worker/src/studio/reports/plugin.ts` |
| `f97ef8aa3005fe75d381eed1192fe98d737da62708e9a5e79563e9146c613178` | `public-entrypoint` | `packages/evals/src/studio-gate.ts` | `apps/worker/src/studio/reports/plugin.ts` |
| `9dbacf6be1ca2a3623ca17242887a6e1fa1f08224eadb1101a081eca7af9dc30` | `no-shared-to-app` | `packages/evals/src/studio-gate.ts` | `apps/worker/src/studio/reports/vertex-model.ts` |
| `9dbacf6be1ca2a3623ca17242887a6e1fa1f08224eadb1101a081eca7af9dc30` | `public-entrypoint` | `packages/evals/src/studio-gate.ts` | `apps/worker/src/studio/reports/vertex-model.ts` |
| `30cd10ac599481864b0eaad658eba4770b02d14e87f0aeb78a2da96d7903315a` | `no-shared-to-app` | `packages/evals/src/studio-gate.ts` | `apps/worker/src/studio/runner.ts` |
| `30cd10ac599481864b0eaad658eba4770b02d14e87f0aeb78a2da96d7903315a` | `public-entrypoint` | `packages/evals/src/studio-gate.ts` | `apps/worker/src/studio/runner.ts` |
| `1923fa01d457086f21de224a7eb7f864fd3a08f7a5ab0c051b0be29ceddc6828` | `no-shared-to-app` | `packages/evals/test/studio-reports-gate.eval.test.ts` | `apps/worker/src/studio/runner.ts` |
| `1923fa01d457086f21de224a7eb7f864fd3a08f7a5ab0c051b0be29ceddc6828` | `public-entrypoint` | `packages/evals/test/studio-reports-gate.eval.test.ts` | `apps/worker/src/studio/runner.ts` |

### Slot 9 · 011-studio-mindmaps-data-tables

| Fingerprint | Rule | Importer | Target |
| --- | --- | --- | --- |
| `8299ce8e7f887ff009e430d26fbcf839fa002588bbc00054b3d40af56c0d30ac` | `no-cross-app` | `apps/api/src/v2/runtime.ts` | `apps/worker/src/studio/mindmaps/model.ts` |
| `8299ce8e7f887ff009e430d26fbcf839fa002588bbc00054b3d40af56c0d30ac` | `public-entrypoint` | `apps/api/src/v2/runtime.ts` | `apps/worker/src/studio/mindmaps/model.ts` |
| `6a931285e502d5b2a14de016144e47f3964355c364dc3d63aff6a5b6d711961d` | `no-cross-app` | `apps/api/src/v2/runtime.ts` | `apps/worker/src/studio/tables/model.ts` |
| `6a931285e502d5b2a14de016144e47f3964355c364dc3d63aff6a5b6d711961d` | `public-entrypoint` | `apps/api/src/v2/runtime.ts` | `apps/worker/src/studio/tables/model.ts` |
| `95d7d491d905b8569cd8d0a35c108c792630a2d2d395f987f2cc4a8d6ae617a7` | `no-shared-to-app` | `packages/evals/src/studio-structure-eval.ts` | `apps/worker/src/studio/mindmaps/model.ts` |
| `95d7d491d905b8569cd8d0a35c108c792630a2d2d395f987f2cc4a8d6ae617a7` | `public-entrypoint` | `packages/evals/src/studio-structure-eval.ts` | `apps/worker/src/studio/mindmaps/model.ts` |
| `60c7d1fcfac12c2c6b4cbbe22a4c6f8d0680074583f16fd00c523f24f4f149d1` | `no-shared-to-app` | `packages/evals/src/studio-structure-eval.ts` | `apps/worker/src/studio/mindmaps/pipeline.ts` |
| `60c7d1fcfac12c2c6b4cbbe22a4c6f8d0680074583f16fd00c523f24f4f149d1` | `public-entrypoint` | `packages/evals/src/studio-structure-eval.ts` | `apps/worker/src/studio/mindmaps/pipeline.ts` |
| `055d80176ef845b7b0e815cc04ef78f85da22859c40e9e593fde89263211c758` | `no-shared-to-app` | `packages/evals/src/studio-structure-eval.ts` | `apps/worker/src/studio/mindmaps/validation.ts` |
| `055d80176ef845b7b0e815cc04ef78f85da22859c40e9e593fde89263211c758` | `public-entrypoint` | `packages/evals/src/studio-structure-eval.ts` | `apps/worker/src/studio/mindmaps/validation.ts` |
| `6f0a974846370dd738e73fa6f50a7f69461cb3c66da0f3e1cf71844e3253cc92` | `no-shared-to-app` | `packages/evals/src/studio-structure-eval.ts` | `apps/worker/src/studio/tables/model.ts` |
| `6f0a974846370dd738e73fa6f50a7f69461cb3c66da0f3e1cf71844e3253cc92` | `public-entrypoint` | `packages/evals/src/studio-structure-eval.ts` | `apps/worker/src/studio/tables/model.ts` |
| `996300e2daa7aa39e5638ed8e0cd63268d6b1878a2c3792639992d877e7d4ac9` | `no-shared-to-app` | `packages/evals/src/studio-structure-eval.ts` | `apps/worker/src/studio/tables/pipeline.ts` |
| `996300e2daa7aa39e5638ed8e0cd63268d6b1878a2c3792639992d877e7d4ac9` | `public-entrypoint` | `packages/evals/src/studio-structure-eval.ts` | `apps/worker/src/studio/tables/pipeline.ts` |
| `9dd7055a130e408f83da7cf55d2670b2554c91127702a5a59c825213fcde7e13` | `no-shared-to-app` | `packages/evals/src/studio-structure-eval.ts` | `apps/worker/src/studio/tables/validation.ts` |
| `9dd7055a130e408f83da7cf55d2670b2554c91127702a5a59c825213fcde7e13` | `public-entrypoint` | `packages/evals/src/studio-structure-eval.ts` | `apps/worker/src/studio/tables/validation.ts` |

### Slot 10 · 010-code-execution-sandbox

| Fingerprint | Rule | Importer | Target |
| --- | --- | --- | --- |
| `645ac98527bc58401d12b2fde605bcf9c331d094e61af6f8594796f37b52e092` | `no-cross-app` | `apps/web/test/e2e-v3-doubles.ts` | `apps/api/src/chat/execution/runtime.ts` |
| `645ac98527bc58401d12b2fde605bcf9c331d094e61af6f8594796f37b52e092` | `public-entrypoint` | `apps/web/test/e2e-v3-doubles.ts` | `apps/api/src/chat/execution/runtime.ts` |
| `962923f7f8f3c8d67fab9886a804eb8476c2e6fe33081faa2783e6e2df500201` | `no-shared-to-app` | `packages/evals/test/code-execution.eval.test.ts` | `apps/api/src/chat/draft.ts` |
| `962923f7f8f3c8d67fab9886a804eb8476c2e6fe33081faa2783e6e2df500201` | `public-entrypoint` | `packages/evals/test/code-execution.eval.test.ts` | `apps/api/src/chat/draft.ts` |
| `645ac98527bc58401d12b2fde605bcf9c331d094e61af6f8594796f37b52e092` | `no-shared-to-app` | `packages/evals/test/code-execution.eval.test.ts` | `apps/api/src/chat/execution/runtime.ts` |
| `645ac98527bc58401d12b2fde605bcf9c331d094e61af6f8594796f37b52e092` | `public-entrypoint` | `packages/evals/test/code-execution.eval.test.ts` | `apps/api/src/chat/execution/runtime.ts` |
| `6431997816539ee451fca947f439c97040b212c2ee692db02133e6d15af60cf0` | `no-shared-to-app` | `packages/evals/test/code-execution.eval.test.ts` | `apps/api/src/chat/model.ts` |
| `6431997816539ee451fca947f439c97040b212c2ee692db02133e6d15af60cf0` | `public-entrypoint` | `packages/evals/test/code-execution.eval.test.ts` | `apps/api/src/chat/model.ts` |
| `80b6ff669c32686dda2919f67ad0ff1d5366a980dabf2d9ce666f3e69000f0dd` | `no-shared-to-app` | `packages/evals/test/code-execution.eval.test.ts` | `apps/api/src/chat/service.ts` |
| `80b6ff669c32686dda2919f67ad0ff1d5366a980dabf2d9ce666f3e69000f0dd` | `public-entrypoint` | `packages/evals/test/code-execution.eval.test.ts` | `apps/api/src/chat/service.ts` |

### Slot 11 · 012-long-context-latency-scaling

| Fingerprint | Rule | Importer | Target |
| --- | --- | --- | --- |
| `1f808abbff9e9e14a3a32173947aa4a9a624f2269e1806f9d1bd2a0e8fdc07af` | `no-shared-to-app` | `packages/evals/test/v3-scale.eval.test.ts` | `apps/api/src/chat/verifier.ts` |
| `1f808abbff9e9e14a3a32173947aa4a9a624f2269e1806f9d1bd2a0e8fdc07af` | `public-entrypoint` | `packages/evals/test/v3-scale.eval.test.ts` | `apps/api/src/chat/verifier.ts` |

### Slot 12 · 013-v2-persistence-postgres

| Fingerprint | Rule | Importer | Target |
| --- | --- | --- | --- |
| `556f9048e0076ce5313b4e9f9d84713ccf33e48f784071acdf7c295d92016fec` | `no-cross-app` | `apps/api/src/v2/runtime.ts` | `apps/worker/src/package-v2-2-runtime.ts` |
| `556f9048e0076ce5313b4e9f9d84713ccf33e48f784071acdf7c295d92016fec` | `public-entrypoint` | `apps/api/src/v2/runtime.ts` | `apps/worker/src/package-v2-2-runtime.ts` |
| `78c4c47b540062ef1b3d1c761c02cf060f6009c0172d7a72459e0227dab82607` | `no-cross-app` | `apps/api/test/package-v2-2-runtime.test.ts` | `apps/worker/src/package-v2-2.ts` |
| `78c4c47b540062ef1b3d1c761c02cf060f6009c0172d7a72459e0227dab82607` | `public-entrypoint` | `apps/api/test/package-v2-2-runtime.test.ts` | `apps/worker/src/package-v2-2.ts` |
| `556f9048e0076ce5313b4e9f9d84713ccf33e48f784071acdf7c295d92016fec` | `no-cross-app` | `apps/api/test/package-v2-2.test.ts` | `apps/worker/src/package-v2-2-runtime.ts` |
| `556f9048e0076ce5313b4e9f9d84713ccf33e48f784071acdf7c295d92016fec` | `public-entrypoint` | `apps/api/test/package-v2-2.test.ts` | `apps/worker/src/package-v2-2-runtime.ts` |
| `78c4c47b540062ef1b3d1c761c02cf060f6009c0172d7a72459e0227dab82607` | `no-cross-app` | `apps/api/test/v2-restart.integration.test.ts` | `apps/worker/src/package-v2-2.ts` |
| `78c4c47b540062ef1b3d1c761c02cf060f6009c0172d7a72459e0227dab82607` | `public-entrypoint` | `apps/api/test/v2-restart.integration.test.ts` | `apps/worker/src/package-v2-2.ts` |

### Slot 13 · 004-ui-skeleton-quality-gates

| Fingerprint | Rule | Importer | Target |
| --- | --- | --- | --- |
| `1c7e06290f7dc4478519f553c8ff538236ff41f3854371dc741093d2f9fbeb7c` | `wildcard-export` | `apps/api/package.json` | `./*` |
| `191a8e76dd2481968afa74e642836033d4bde6977219e7a590cbc6785a18b891` | `no-cross-app` | `apps/api/package.json` | `apps/worker/package.json` |
| `cf4248fd5aa3247942d7294c84b996838c5540a0e211317cfde283be09d6f49b` | `no-cross-app` | `apps/web/package.json` | `apps/api/package.json` |
| `fa4f8fb40fcbbbb1626239cc3a16ac417437f8627e3c078e37471a5cc8a4c4e8` | `no-cross-app` | `apps/web/package.json` | `apps/worker/package.json` |
| `6bca4661f543deaaf6b199e1981bef7e04c588405077f1f112837faebb8d8181` | `no-cross-app` | `apps/web/test/e2e-server.ts` | `apps/api/src/app.ts` |
| `6bca4661f543deaaf6b199e1981bef7e04c588405077f1f112837faebb8d8181` | `public-entrypoint` | `apps/web/test/e2e-server.ts` | `apps/api/src/app.ts` |
| `501bf9235cd2ce4defa04274cf28e70e8f1de15c2f811f13e4b1fa0f52f9d065` | `no-cross-app` | `apps/web/test/e2e-server.ts` | `apps/api/src/v2/runtime.ts` |
| `501bf9235cd2ce4defa04274cf28e70e8f1de15c2f811f13e4b1fa0f52f9d065` | `public-entrypoint` | `apps/web/test/e2e-server.ts` | `apps/api/src/v2/runtime.ts` |
| `e81b69ab0355e80a8e3b7a19223c59bc6b97ab5820eaf76b50897462ec63f0eb` | `no-cross-app` | `apps/web/test/e2e-server.ts` | `apps/worker/src/index.ts` |
| `ed57964c6eac3040013be65e53f125dc5919769ee677af972b54d8e759c04783` | `wildcard-export` | `apps/worker/package.json` | `./*` |
| `9bf6c0eacc04705b586fd5c84d4d35b398879accb1019a92e65593e0179710db` | `wildcard-export` | `packages/contracts/package.json` | `./*` |
| `2d28fbe4daad061a6077a3494140bc0934cdb55e4ab6b955547581cec69e8f24` | `contracts-only` | `packages/contracts/src/scoped-context.ts` | `node:crypto` |
| `14f97bbca3059058418b10edab3363a841b9bc78202cdc693634e1681f2192d1` | `no-shared-to-app` | `packages/evals/package.json` | `apps/api/package.json` |
| `191a8e76dd2481968afa74e642836033d4bde6977219e7a590cbc6785a18b891` | `no-shared-to-app` | `packages/evals/package.json` | `apps/worker/package.json` |
