# Hidden in Art —— 升级为工程级 AI Agent 的实施方案

> 状态:**方案待审**。本文档只描述要做什么、为什么、接口长什么样,**不含已落地代码**。审核通过后再按阶段实现。

## 0. 背景与现状判断

`hidden-in-art` 当前是纯客户端 Next.js 应用:上传照片 → 分析色彩/纹理 → 用启发式算法从名画库推荐 → 用名画调色板/笔触重建照片。整条链路是**确定性规则**,无 LLM。

**关键发现:项目已经有一套写好但未实现的 agent 契约。** `tests/` 下 5 个 `agent.*.test.ts` 已用 TDD 风格精确定义了 agent 的行为,但它们 import 的 5 个源文件全部缺失:

| 测试 | 期望源文件 | 现状 |
|---|---|---|
| `agent.settings.test.ts` | `src/domain/agent/settings.ts` + `types.ts` | 缺失 |
| `agent.tools.test.ts` | `src/domain/agent/tools.ts` | 缺失 |
| `agent.runner.test.ts` | `src/domain/agent/runner.ts` | 缺失 |
| `agent.matchArtwork.test.ts` | `src/domain/agent/matchArtwork.ts` | 缺失 |
| (共用) `tests/fixtures.ts` | `AgentArtwork` 类型 (`types.ts`) | 缺失 |

设计意图很清晰:用户用**自然语言**(如 "use a swirling van gogh look, a bit more detail")驱动重建,LLM 通过工具调用修改设置(目标画作、patch 密度、配色算法、抽象度、焦点区域),画布实时更新。架构已用**依赖注入**把 LLM 调用 (`callLlm`) 与领域逻辑解耦——这正是工程级 agent 的正确分层。

因此本方案的本质是:**把已定义好的契约实现出来,再接真实 LLM、API 路由和聊天 UI。**

---

## 1. 目标分层架构

```
src/
  domain/agent/           ← 纯领域层,零网络、零框架、100% 可单测
    types.ts              ← AgentArtwork / AgentSettings / 常量 / 默认值
    settings.ts           ← 纯函数:clamp / 调整 / jitter / 焦点框
    matchArtwork.ts       ← 自然语言 → 名画排序(确定性,无 LLM)
    tools.ts              ← 工具定义 + executeTool(校验、优雅失败)
    runner.ts             ← agent 主循环 runAgentTurn(依赖注入 callLlm)
  infrastructure/llm/     ← 阶段2:真实 LLM 适配器,实现 LlmCaller 接口
    <provider>Caller.ts
app/
  api/agent/route.ts      ← 阶段3:服务端路由,持有 API key
  page.tsx                ← 阶段4:接入聊天 UI
```

依赖方向严格单向:`runner → tools → settings/matchArtwork → types`,领域层不依赖 React/Next/网络。

---

## 2. 各模块契约(从现有测试逆向,签名须一字对齐)

### 2.1 `types.ts`

```ts
export const PATCH_MIN = 1600;
export const PATCH_MAX = 4000;          // step=100 的整数倍;clamp 上界
export const PATCH_STEP = 100;

export type ColorMatch = "nearest" | "jitter" | "dither";
export type FocalRegion =
  | "auto" | "center"
  | "top-left" | "top-right" | "bottom-left" | "bottom-right";

export type AgentArtwork = {
  id: string; title: string; artist: string;
  category: string; tags: string[]; mood: string[];
};

export type AgentSettings = {
  targetArtworkId: string | null;
  patchCount: number;
  colorMatch: ColorMatch;
  abstraction: number;        // 0..1
  focalRegion: FocalRegion;
};

export const DEFAULT_SETTINGS: AgentSettings = {
  targetArtworkId: null,
  patchCount: 2500,
  colorMatch: "nearest",
  abstraction: 0.35,          // 待定;需让 settings 测试通过
  focalRegion: "auto",
};
```

**测试钉死的事实**:`DEFAULT_SETTINGS.patchCount === 2500`、`targetArtworkId === null`(runner 测试断言失败后仍为 `null`)。

### 2.2 `settings.ts`(纯函数)

| 函数 | 签名 | 测试钉死的行为 |
|---|---|---|
| `clamp01` | `(n) => number` | `0.5→0.5`,`-3→0`,`2→1`,`NaN→0` |
| `clampPatchCount` | `(n) => number` | 四舍五入到 100;`2543→2500`;越界 clamp;`Infinity→PATCH_MIN` |
| `adjustPatchCount` | `(cur, dir, amount?) => number` | `slight=400, moderate=900(默认), large=1500`;结果再 clamp。`(2500,"more","slight")→2900`,`(2500,"less","moderate")→1600`,`(2500,"more")→3400` |
| `adjustAbstraction` | `(cur, dir, amount?) => number` | `slight=0.15`;`(0.35,"more","slight")→0.5`,`(0.1,"less","large")→0`,`(0.9,"more","large")→1`;结果 clamp01 |
| `jitterCoeff` | `({colorMatch, abstraction}) => number` | `nearest→0`;`jitter` 在同抽象度下 `>0`;`dither < jitter`(dither 更收敛) |
| `focalRegionToBox` | `(region) => {nx0,ny0,nx1,ny1} \| null` | `auto→null`;`center` 框中心 =(0.5,0.5);`top-left` 框中心 <(0.5,0.5) 且 `nx0,ny0 ≥ 0` |

> `amount` 类型:`"slight" | "moderate" | "large"`,默认 `"moderate"`。`dir` 类型:`"more" | "less"`。

### 2.3 `matchArtwork.ts`(确定性 NL → 名画排序)

```ts
export function matchArtwork(
  query: string, library: AgentArtwork[]
): { artwork: AgentArtwork; score: number }[];
```

测试钉死的行为:
- 命中 artist(`"van gogh"` → van Gogh)、tags(`"water reflections"` → 含 `water` 的 Monet 排第一)、category(`"a dramatic portrait"` → `category==="portrait"`)、mood/语义(`"abstract and expressive"` → `met-437984`,其 tags 含 `expressive`)。
- **无匹配返回 `[]`**(`"zxcvbnm qwerty"`)。
- **纯停用词返回 `[]`**(`"make it look like the style of"`)——需维护一份停用词表,过滤后无有效 token 即空。

实现要点:分词 → 去停用词 → 对每个画作按 artist/tags/category/mood 命中累加权重 → 排序 → 过滤 score≤0。

### 2.4 `tools.ts`

```ts
export type ToolContext = { settings: AgentSettings; library: AgentArtwork[] };
export type ToolResult = {
  ok: boolean;
  patch: Partial<AgentSettings>;   // 失败时为 {}
  summary: string;
};
export const ART_AGENT_TOOLS: {
  name: string; description: string;
  input_schema: { type: "object"; properties: ...; required?: string[] };
}[];
export function executeTool(name, input, ctx): ToolResult;
```

5 个工具及测试钉死的行为:

| 工具 | 入参 | 行为 |
|---|---|---|
| `set_target_painting` | `{query}` | 调 `matchArtwork`;命中→`patch.targetArtworkId`,`summary` 含画家名;无命中→`ok:false, patch:{}, summary` 含 "Nothing in the library" |
| `set_patch_density` | `{value}` 或 `{direction, amount?}` | 绝对值经 `clampPatchCount`(`3333→3300`);相对走 `adjustPatchCount`;两者皆无→`ok:false` |
| `set_color_matching` | `{algorithm, abstraction?}` | 校验 `algorithm ∈ {nearest,jitter,dither}`,非法→`ok:false`;可同时设 `abstraction` |
| `adjust_abstraction` | `{value}` 或 `{direction, amount?}` | 绝对值 clamp01;相对走 `adjustAbstraction`;空入参→`ok:false` |
| `set_focal_region` | `{region}` | 校验 region 名,非法→`ok:false` |
| (未知工具名) | — | **不抛异常**,返回 `ok:false, summary` 含 "Unknown tool" |

每个 `description.length > 10`,`input_schema.type === "object"`(`agent.tools.test.ts` 通用断言)。

### 2.5 `runner.ts`(agent 主循环)

```ts
export type ToolUseBlock = { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };
export type LlmResponse = { stop_reason: "tool_use" | "end_turn"; content: ContentBlock[] };
export type LlmCaller = (args: { system: string; messages: Message[]; tools: Tool[] }) => Promise<LlmResponse>;

export function buildSystemPrompt(settings: AgentSettings, library: AgentArtwork[]): string;
export function runAgentTurn(args: {
  userMessage: string;
  callLlm: LlmCaller;
  settings: AgentSettings;
  library: AgentArtwork[];
  maxSteps?: number;
}): Promise<{
  reply: string;
  settings: AgentSettings;
  toolCalls: { name: string; ok: boolean; ... }[];
  messages: Message[];
}>;
```

测试钉死的行为(消息形状采用 **Anthropic Messages API** 格式):
- 循环:LLM 返回 `tool_use` → 执行每个工具、把 `patch` 合并进 settings → 以 `tool_result` 回传 → 再次调 LLM,直到 `end_turn`。
- 转录角色序列:`["user","assistant","user","assistant"]`,其中 `messages[2].content[0].type === "tool_result"`。
- 无工具时直接返回文本,`toolCalls.length === 0`,settings 不变。
- 工具失败时 settings 不变,但循环继续(把失败结果回传给模型)。
- `maxSteps`(默认建议 8)截断:达到上限后给优雅兜底回复,不无限循环。
- 首次调用须带 `tools`(非空)和含 "Hidden in Art" 的 `system`;`buildSystemPrompt` 须反映实时 `patches=<n>`、`colorMatch=<x>` 及库中画家名。

> **此阶段不接真实网络**:`callLlm` 由调用方注入,测试用脚本化 mock,真实环境注入 provider 适配器。

---

## 3. 实施阶段与验收

### 阶段 1 —— 领域层(无网络,推荐先做)
**做**:实现 §2.1–2.5 五个文件。
**验收**:`npm test` 全绿(已有 5 个测试文件覆盖 settings/tools/runner/matchArtwork);`npm run lint` 通过;`npx tsc --noEmit` 无错。
**价值**:不需要任何 API key,把项目从"规则引擎"升级为有正经测试覆盖的 agent 内核。**这一步可立即开始。**

### 阶段 2 —— 真实 LLM 适配器
**做**:`src/infrastructure/llm/<provider>Caller.ts` 实现 `LlmCaller`。Anthropic 路线最省事(测试里的 `tool_use`/`tool_result`/`stop_reason` 就是 Anthropic Messages 的形状);OpenAI 路线需在适配器内翻译 function-calling 格式。
**前置**:需确定 provider + 提供 API key。**(当前 provider 未定,此阶段挂起)**
**验收**:用真实 key 跑一次端到端;适配器有契约测试(可对 SDK 打桩)。

### 阶段 3 —— API 路由 + 密钥安全
**做**:`app/api/agent/route.ts`(server 端),key 走环境变量,**绝不下发浏览器**。加输入长度限制、基本限流、错误兜底。
**验收**:浏览器网络面板确认请求只到本站 `/api/agent`,key 不出现在任何客户端 bundle。

### 阶段 4 —— 聊天 UI
**做**:`page.tsx` 增加对话输入框,把 agent 返回的 `settings.patchCount` / `targetArtworkId` 接到现有 `patchCount` / `selectedArtwork` 状态,画布实时重渲染。复用现有 `CanvasRenderer`。
**验收**:浏览器内实测黄金路径("用梵高风格,再细一点" → 目标切到梵高、patch 增加、画布更新)与边界(无匹配画作时的优雅提示)。

---

## 4. 风险与权衡

- **阶段 1 零风险**:离线、纯函数、被测试完全约束,先做最稳。
- **阶段 2+ 引入网络/成本/延迟**:需 key,需考虑限流与超时。
- **`PATCH_MAX` 取值待确认**:UI Slider 当前 `max=4096`,但 agent 需 step=100 的整数倍,本方案取 `4000`。需决定:统一到 4000,还是 UI 与 agent 各用各的上界(后者要在接线处做一次映射)。
- **provider 未定**:阶段 1 完全不受影响;一旦定,阶段 2 改动只在 `infrastructure/llm/` 一个文件。

---

## 5. 建议的下一步

先执行**阶段 1**:实现领域层让 5 个测试全绿。这是不依赖任何外部决策、立刻可交付的一步,完成后项目即具备 agent 内核与测试护栏。阶段 2–4 待 provider/key 确定后继续。
