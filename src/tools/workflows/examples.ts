/**
 * Example Workflows
 * 
 * Pre-built workflows demonstrating the composed tools system
 */

import type { WorkflowDefinition } from "../tools/types.js";

/**
 * Research and visualize workflow
 * Research a topic and generate a diagram
 */
export const researchAndVisualizeWorkflow: WorkflowDefinition = {
  name: "research-and-visualize",
  description: "Research a topic and generate a visualization diagram",
  steps: [
    {
      id: "research",
      tool: "cloud.research",
      input: { query: "$args.topic", depth: "$args.depth || 2" },
      output: "research_result",
    },
    {
      id: "summarize",
      tool: "agent.WebResearcher.summarize",
      input: { 
        content: "$research_result.summary", 
        style: "bullet-points",
        maxLength: 300
      },
      output: "summary",
    },
    {
      id: "diagram",
      tool: "cloud.image.generate",
      input: { 
        prompt: "Technical diagram showing: $summary.content. Clean, professional style with labels.",
        style: "technical"
      },
      output: "diagram_url",
      condition: "$research_result.success == true",
    },
  ],
};

/**
 * Code review workflow
 * Analyze code and provide feedback
 */
export const codeReviewWorkflow: WorkflowDefinition = {
  name: "code-review",
  description: "Review code from a file or snippet and provide detailed feedback",
  steps: [
    {
      id: "read",
      tool: "local.file.read",
      input: { path: "$args.filePath" },
      output: "code_content",
      condition: "$args.filePath != null",
    },
    {
      id: "analyze",
      tool: "local.reasoning",
      input: {
        prompt: "Review this code for bugs, security issues, and improvements:",
        context: "$args.code || $code_content.content",
      },
      output: "analysis",
    },
    {
      id: "search_patterns",
      tool: "local.memory.search",
      input: { 
        query: "code review patterns $args.language",
        limit: 3
      },
      output: "patterns",
    },
    {
      id: "final_review",
      tool: "local.reasoning",
      input: {
        prompt: "Synthesize code review incorporating best practices:",
        context: "Analysis: $analysis.response\n\nPatterns: $patterns.results",
      },
      output: "final_report",
    },
  ],
};

/**
 * Document creation workflow
 * Research and create comprehensive documentation
 */
export const documentCreationWorkflow: WorkflowDefinition = {
  name: "create-documentation",
  description: "Create comprehensive documentation for a topic or project",
  steps: [
    {
      id: "research",
      tool: "cloud.research",
      input: { 
        query: "$args.topic documentation best practices",
        depth: 2
      },
      output: "research",
    },
    {
      id: "list_files",
      tool: "local.file.list",
      input: { 
        directory: "$args.projectPath || .",
        pattern: "**/*.md"
      },
      output: "existing_docs",
      condition: "$args.projectPath != null",
    },
    {
      id: "generate_outline",
      tool: "local.reasoning",
      input: {
        prompt: "Create documentation outline for: $args.topic",
        context: "Research: $research.summary\n\nExisting docs: $existing_docs.files",
      },
      output: "outline",
    },
    {
      id: "write_content",
      tool: "local.reasoning",
      input: {
        prompt: "Write comprehensive documentation following the outline",
        context: "$outline.response",
      },
      output: "content",
    },
    {
      id: "save",
      tool: "local.file.write",
      input: {
        path: "$args.outputPath || ./docs/$args.topic.md",
        content: "$content.response",
      },
      condition: "$args.outputPath != null",
    },
  ],
};

/**
 * Data analysis workflow
 * Fetch data, analyze, and visualize
 */
export const dataAnalysisWorkflow: WorkflowDefinition = {
  name: "analyze-data",
  description: "Fetch data from an API, analyze it, and create visualizations",
  steps: [
    {
      id: "fetch",
      tool: "local.http.request",
      input: {
        url: "$args.dataUrl",
        method: "GET",
        headers: "$args.headers || {}",
      },
      output: "raw_data",
    },
    {
      id: "analyze",
      tool: "cloud.reasoning",
      input: {
        prompt: "Analyze this data and extract key insights, trends, and anomalies:",
        context: "Data: $raw_data.data",
      },
      output: "analysis",
    },
    {
      id: "visualize",
      tool: "cloud.image.generate",
      input: {
        prompt: "Data visualization chart showing: $analysis.response. Professional style, clear labels.",
        style: "professional",
      },
      output: "chart_url",
    },
    {
      id: "report",
      tool: "local.reasoning",
      input: {
        prompt: "Generate executive summary report from analysis",
        context: "Analysis: $analysis.response\nChart: $chart_url",
      },
      output: "report",
    },
  ],
};

/**
 * Bug investigation workflow
 * Deep investigation of a bug with multiple tools
 */
export const bugInvestigationWorkflow: WorkflowDefinition = {
  name: "investigate-bug",
  description: "Investigate a bug by checking logs, code, and generating fix suggestions",
  steps: [
    {
      id: "search_logs",
      tool: "local.shell.safe",
      input: {
        command: "grep -r '$args.errorPattern' ./logs ./src || echo 'No matches'",
      },
      output: "logs",
    },
    {
      id: "search_code",
      tool: "local.shell.safe",
      input: {
        command: "find ./src -name '*.ts' -o -name '*.js' | xargs grep -l '$args.errorPattern' 2>/dev/null || echo 'No matches'",
      },
      output: "relevant_files",
    },
    {
      id: "read_context",
      tool: "local.file.read",
      input: { path: "$relevant_files.stdout.split('\\n')[0]" },
      output: "code_context",
      condition: "$relevant_files.stdout != 'No matches'",
    },
    {
      id: "memory_search",
      tool: "local.memory.search",
      input: {
        query: "$args.errorPattern bug fix",
        limit: 5,
      },
      output: "similar_bugs",
    },
    {
      id: "investigate",
      tool: "local.reasoning",
      input: {
        prompt: "Investigate this bug and suggest fixes:",
        context: "Logs: $logs.stdout\n\nCode: $code_context.content\n\nSimilar bugs: $similar_bugs.results",
      },
      output: "investigation",
    },
    {
      id: "deep_analysis",
      tool: "cloud.reasoning",
      input: {
        prompt: "Deep analysis of bug with fix recommendations:",
        context: "$investigation.response",
      },
      output: "final_recommendations",
      condition: "$args.useCloud == true",
    },
  ],
};

/**
 * Content creation workflow
 * Create blog post or article with research
 */
export const contentCreationWorkflow: WorkflowDefinition = {
  name: "create-content",
  description: "Create blog post or article with research and optimization",
  steps: [
    {
      id: "research_topic",
      tool: "cloud.research",
      input: {
        query: "$args.topic",
        depth: "$args.researchDepth || 2",
      },
      output: "research",
    },
    {
      id: "check_seo",
      tool: "local.memory.search",
      input: {
        query: "SEO keywords $args.topic",
        limit: 10,
      },
      output: "seo_data",
    },
    {
      id: "write_draft",
      tool: "local.reasoning",
      input: {
        prompt: "Write blog post draft about: $args.topic",
        context: "Research: $research.summary\nSEO: $seo_data.results",
      },
      output: "draft",
    },
    {
      id: "enhance",
      tool: "cloud.reasoning",
      input: {
        prompt: "Enhance and optimize this content:",
        context: "$draft.response",
      },
      output: "enhanced",
      condition: "$args.enhanceWithCloud == true",
    },
    {
      id: "generate_image",
      tool: "cloud.image.generate",
      input: {
        prompt: "Featured image for article about: $args.topic. $args.imageStyle style.",
        style: "$args.imageStyle || artistic",
      },
      output: "featured_image",
      condition: "$args.generateImage == true",
    },
    {
      id: "finalize",
      tool: "local.reasoning",
      input: {
        prompt: "Final editing and formatting",
        context: "Content: $enhanced.response || $draft.response\nImage: $featured_image",
      },
      output: "final_content",
    },
  ],
};

// Export all workflows
export const exampleWorkflows: WorkflowDefinition[] = [
  researchAndVisualizeWorkflow,
  codeReviewWorkflow,
  documentCreationWorkflow,
  dataAnalysisWorkflow,
  bugInvestigationWorkflow,
  contentCreationWorkflow,
];
