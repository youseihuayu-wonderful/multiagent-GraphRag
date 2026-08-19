import evaluationData from './generated/evaluation.json'
import graphData from './generated/knowledge_graph.json'
import scenarioData from './generated/scenarios.json'
import type { EvaluationBundle, KnowledgeGraphBundle, ScenarioBundle } from './types'

export const scenarioBundle = scenarioData as unknown as ScenarioBundle
export const evaluationBundle = evaluationData as unknown as EvaluationBundle
export const knowledgeGraph = graphData as unknown as KnowledgeGraphBundle
export const scenarios = scenarioBundle.scenarios
export const recordedDemo = scenarios[0].response
export const sampleQueries = scenarios.slice(0, 3).map((scenario) => scenario.query)
