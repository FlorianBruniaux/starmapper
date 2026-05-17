---
name: design-patterns
description: "Use when analyzing a codebase for GoF design patterns, or when refactoring and needing pattern suggestions. Stack-aware (TypeScript/React/Next.js adaptations)."
allowed-tools: Read, Grep, Glob
context: fork
agent: specialist
version: 1.0.0
effort: medium
tags: [design-patterns, gof, architecture, refactor, typescript]
---

# Design Patterns Analyzer Skill

**Purpose**: Detect, suggest, and evaluate Gang of Four (GoF) design patterns in TypeScript/JavaScript codebases with stack-aware adaptations.

## Core Capabilities

1. **Stack Detection**: Identify primary framework/library (React, Next.js, MapLibre, Prisma)
2. **Pattern Detection**: Find existing implementations of 23 GoF patterns
3. **Smart Suggestions**: Recommend patterns to fix code smells, using stack-native idioms when available
4. **Quality Evaluation**: Assess pattern implementation quality against best practices

## StarMapper Stack Context

- **Primary**: React 18 + Next.js App Router + TypeScript
- **Map**: MapLibre GL 5.x (event-driven, callback patterns)
- **DB**: Prisma 7 + Neon (repository pattern already applied)
- **State**: React hooks (no Redux/Zustand — client-side state in map page component)
- **Geocoding**: 3-tier cascade (Jawg → Geoapify → Nominatim) — Strategy pattern candidate

## Operating Modes

### Mode 1: Detection

**Trigger**: User requests pattern detection or analysis
**Output**: Report of patterns found with confidence scores and stack context

**Workflow**:

```
1. Stack Detection (package.json, tsconfig.json, framework files)
2. Pattern Search (Glob for candidates → Grep for signatures → Read for validation)
3. Classification (native to stack vs custom implementations)
4. Confidence Scoring (0.0-1.0 based on detection rules)
5. Report Generation
```

### Mode 2: Suggestion

**Trigger**: User requests pattern suggestions or refactoring advice
**Output**: Markdown report with prioritized suggestions and stack-adapted examples

**Workflow**:

```
1. Code Smell Detection (switch statements, long parameter lists, global state, etc.)
2. Pattern Matching (map smell → applicable patterns)
3. Stack Adaptation (prefer native framework patterns over custom implementations)
4. Priority Ranking (impact × feasibility)
5. Markdown Report with Code Examples
```

### Mode 3: Evaluation

**Trigger**: User requests pattern quality assessment
**Output**: Report with scores per evaluation criterion

## Methodology

### Phase 1: Stack Detection

**Sources** (in priority order):

1. `package.json` → Check dependencies and devDependencies
2. `tsconfig.json` → Check compilerOptions, paths
3. File extensions → `*.tsx` presence count

### Phase 2: Pattern Detection

**Search Strategy**:

1. **Glob Phase**: Find candidate files by naming convention
   - `*Singleton*.ts`, `*Factory*.ts`, `*Strategy*.ts`, `*Observer*.ts`, etc.

2. **Grep Phase**: Search for pattern signatures
   - Primary signals: `private constructor`, `static getInstance()`, `subscribe()`, `createXxx()`, etc.

3. **Read Phase**: Validate pattern structure

### Phase 3: Code Smell Detection

**Target Smells**:

1. **Switch on Type** → Strategy/Factory pattern
2. **Long Parameter List (>4)** → Builder pattern
3. **Global State Access** → Singleton (or preferably React Context)
4. **Duplicated Conditionals on State** → State pattern
5. **Scattered Notification Logic** → Observer pattern
6. **Complex Object Creation** → Factory/Abstract Factory
7. **Tight Coupling to Concrete Classes** → Adapter/Bridge
8. **Large Class with Many Responsibilities** → Facade pattern

### Phase 4: Stack-Aware Suggestions

**StarMapper-specific adaptations**:

| Pattern | Current usage | Recommendation |
|---------|--------------|----------------|
| Strategy | Geocoding cascade (if/else chain) | Extract to strategy objects: `JawgStrategy`, `GeoapifyStrategy`, `NominatimStrategy` |
| Observer | React useState in map page | Already idiomatic — use React state |
| Singleton | `prisma` in `db.ts` | Already correct — PrismaClient singleton |
| Facade | `fetchAndPatchStyle()` in `map-style.ts` | Already applied — keep as is |
| Iterator | Chunk loop in page.tsx | Already idiomatic async iterator pattern |

### Phase 5: Quality Evaluation

**Criteria**:

1. **Correctness (0-10)**: Does it match the canonical pattern structure?
2. **Testability (0-10)**: Can dependencies be mocked/stubbed easily?
3. **Single Responsibility (0-10)**: Does it do one thing only?
4. **Open/Closed Principle (0-10)**: Extensible without modification?
5. **Documentation (0-10)**: Clear intent, descriptive naming?

## Output Format

### Detection Mode

```
## Design Patterns Found

### Singleton — src/lib/db.ts:1-15
- Confidence: 0.95
- Type: custom
- Signals: PrismaClient singleton, module-level cache
- Note: Correct pattern for Next.js serverless

### Facade — src/lib/map-style.ts:1-30
- Confidence: 0.88
- Type: custom
- Signals: fetchAndPatchStyle() encapsulates tile URL patching

### Strategy (candidate) — src/lib/geocoder.ts:45-120
- Confidence: 0.60
- Type: implicit (if/else chain, not extracted)
- Suggestion: Extract Jawg/Geoapify/Nominatim as strategy objects for testability
```

### Suggestion Mode

```markdown
## Design Pattern Suggestions

### 1. Strategy Pattern → src/lib/geocoder.ts

**Code Smell**: 3-tier if/else cascade — hard to test individual providers

**Current**: if (jawgResult) ... else if (geoapifyResult) ... else nominatimResult
**Recommended**: Extract strategy objects with a common interface

interface GeocodingStrategy {
  geocode(location: string): Promise<LatLng | null>;
}

const jawgStrategy: GeocodingStrategy = { ... };
const geoapifyStrategy: GeocodingStrategy = { ... };
const nominatimStrategy: GeocodingStrategy = { ... };

const strategies = [jawgStrategy, geoapifyStrategy, nominatimStrategy];
// Waterfall through strategies
```

## Constraints & Guidelines

### Read-Only Analysis

- **No modifications**: This skill only analyzes and suggests, never modifies code
- **User decision**: All suggestions require explicit user approval before implementation

### Language Focus

- **Primary**: TypeScript (`.ts`, `.tsx`)
- **Exclusions**: Other languages not supported

### Pattern Coverage

- **Creational (5)**: Singleton, Factory Method, Abstract Factory, Builder, Prototype
- **Structural (7)**: Adapter, Bridge, Composite, Decorator, Facade, Flyweight, Proxy
- **Behavioral (11)**: Chain of Responsibility, Command, Iterator, Mediator, Memento, Observer, State, Strategy, Template Method, Visitor, Interpreter

## Usage Examples

```bash
# Detect all patterns in src/
/design-patterns detect src/

# Get suggestions for geocoder
/design-patterns suggest src/lib/geocoder.ts

# Evaluate singleton in db.ts
/design-patterns evaluate src/lib/db.ts
```

**Skill Version**: 1.0.0
**Pattern Coverage**: 23 GoF patterns
**Supported Stacks**: React, Next.js, Prisma, MapLibre
