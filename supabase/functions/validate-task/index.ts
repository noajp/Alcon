import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ===========================================
// TOON Encoder/Decoder (Structured)
// ===========================================

interface ToonSchema {
  name: string;
  isArray: boolean;
  count?: number;
  fields: string[];
}

function parseSchema(header: string): ToonSchema | null {
  // Parse: name{field1,field2}: or name[N]{field1,field2}:
  const arrayMatch = header.match(/^(\w+)\[(\d+)?\]\{([^}]+)\}:$/);
  const objectMatch = header.match(/^(\w+)\{([^}]+)\}:$/);

  if (arrayMatch) {
    return {
      name: arrayMatch[1],
      isArray: true,
      count: arrayMatch[2] ? parseInt(arrayMatch[2]) : undefined,
      fields: arrayMatch[3].split(',').map(f => f.trim()),
    };
  }
  if (objectMatch) {
    return {
      name: objectMatch[1],
      isArray: false,
      fields: objectMatch[2].split(',').map(f => f.trim()),
    };
  }
  return null;
}

function encodeToon(data: Record<string, any>): string {
  const lines: string[] = [];

  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value) && value.length > 0) {
      const fields = Object.keys(value[0]);
      lines.push(`${key}[${value.length}]{${fields.join(',')}}:`);
      for (const item of value) {
        const values = fields.map(f => String(item[f] ?? ''));
        lines.push(`  ${values.join('\t')}`);
      }
    } else if (typeof value === 'object' && value !== null) {
      const fields = Object.keys(value);
      lines.push(`${key}{${fields.join(',')}}:`);
      const values = fields.map(f => String(value[f] ?? ''));
      lines.push(`  ${values.join('\t')}`);
    }
  }

  return lines.join('\n');
}

function decodeToon(toonText: string): Record<string, any> {
  const result: Record<string, any> = {};
  const lines = toonText.split('\n');

  let currentSchema: ToonSchema | null = null;
  let currentData: any[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Check if it's a schema line
    const schema = parseSchema(trimmed);
    if (schema) {
      // Save previous block if exists
      if (currentSchema) {
        result[currentSchema.name] = currentSchema.isArray ? currentData : currentData[0];
      }
      currentSchema = schema;
      currentData = [];
      continue;
    }

    // Data line (indented with 2 spaces)
    if (currentSchema && line.startsWith('  ')) {
      const values = trimmed.split('\t');
      const obj: Record<string, any> = {};
      currentSchema.fields.forEach((field, i) => {
        let val: any = values[i] ?? '';
        // Try to parse numbers
        if (/^-?\d+$/.test(val)) val = parseInt(val);
        else if (/^-?\d+\.\d+$/.test(val)) val = parseFloat(val);
        obj[field] = val;
      });
      currentData.push(obj);
    }
  }

  // Save last block
  if (currentSchema) {
    result[currentSchema.name] = currentSchema.isArray ? currentData : currentData[0];
  }

  return result;
}

// ===========================================
// Tool Definitions for Claude
// ===========================================

const tools = [
  {
    name: "search_related_tasks",
    description: "Search for tasks that may be related to or conflict with the new task. Use semantic keywords, not just exact matches.",
    input_schema: {
      type: "object",
      properties: {
        keywords: {
          type: "array",
          items: { type: "string" },
          description: "Keywords to search for (e.g., ['launch', 'release', 'announcement', 'go-live'])"
        },
        date_range: {
          type: "object",
          properties: {
            start: { type: "string", description: "Start date (YYYY-MM-DD)" },
            end: { type: "string", description: "End date (YYYY-MM-DD)" }
          },
          description: "Optional date range to filter tasks"
        },
        exclude_departments: {
          type: "array",
          items: { type: "string" },
          description: "Department IDs to exclude from search"
        }
      },
      required: ["keywords"]
    }
  },
  {
    name: "get_project_context",
    description: "Get detailed context about a project including its team, department, and related projects",
    input_schema: {
      type: "object",
      properties: {
        project_id: {
          type: "string",
          description: "The project ID to get context for"
        }
      },
      required: ["project_id"]
    }
  },
  {
    name: "get_dependency_chain",
    description: "Get the dependency chain for a task (upstream or downstream dependencies)",
    input_schema: {
      type: "object",
      properties: {
        task_id: {
          type: "string",
          description: "The task ID to analyze"
        },
        direction: {
          type: "string",
          enum: ["upstream", "downstream", "both"],
          description: "Direction of dependencies to fetch"
        }
      },
      required: ["task_id", "direction"]
    }
  },
  {
    name: "check_team_workload",
    description: "Check the workload and capacity of a team around a specific date",
    input_schema: {
      type: "object",
      properties: {
        team_id: {
          type: "string",
          description: "The team ID to check"
        },
        date: {
          type: "string",
          description: "The date to check workload around (YYYY-MM-DD)"
        },
        range_days: {
          type: "number",
          description: "Number of days before/after to include (default: 7)"
        }
      },
      required: ["team_id", "date"]
    }
  }
];

// ===========================================
// Tool Execution Functions
// ===========================================

async function executeSearchRelatedTasks(
  supabase: any,
  params: { keywords: string[]; date_range?: { start?: string; end?: string }; exclude_departments?: string[] }
): Promise<string> {
  const { keywords, date_range, exclude_departments } = params;

  // Build search query
  let query = supabase
    .from('tasks')
    .select(`
      id, title, status, due_date, priority,
      section:sections!inner(
        id, name,
        project:projects!inner(
          id, name,
          team:teams!inner(
            id, name,
            department:departments!inner(id, name)
          )
        )
      )
    `)
    .neq('status', 'done');

  // Date range filter
  if (date_range?.start) {
    query = query.gte('due_date', date_range.start);
  }
  if (date_range?.end) {
    query = query.lte('due_date', date_range.end);
  }

  const { data: allTasks, error } = await query;
  if (error) throw error;

  // Filter by keywords (semantic search simulation)
  const keywordLower = keywords.map(k => k.toLowerCase());
  const matchedTasks = (allTasks || []).filter((task: any) => {
    const titleLower = task.title.toLowerCase();
    return keywordLower.some(kw => titleLower.includes(kw));
  });

  // Exclude departments if specified
  let filtered = matchedTasks;
  if (exclude_departments?.length) {
    filtered = matchedTasks.filter((t: any) =>
      !exclude_departments.includes(t.section?.project?.team?.department?.id)
    );
  }

  // Format as TOON
  const formatted = filtered.slice(0, 30).map((t: any) => ({
    id: t.id,
    title: t.title,
    due_date: t.due_date || 'none',
    status: t.status,
    priority: t.priority || 'medium',
    department: t.section?.project?.team?.department?.name || 'unknown',
    dept_id: t.section?.project?.team?.department?.id || '',
    project: t.section?.project?.name || 'unknown',
    team: t.section?.project?.team?.name || 'unknown'
  }));

  return encodeToon({ related_tasks: formatted });
}

async function executeGetProjectContext(
  supabase: any,
  params: { project_id: string }
): Promise<string> {
  const { project_id } = params;

  // Get project with full context
  const { data: project, error: projError } = await supabase
    .from('projects')
    .select(`
      id, name, description, status,
      team:teams!inner(
        id, name,
        department:departments!inner(
          id, name, company_id
        ),
        members(id, name, role)
      ),
      sections(
        id, name,
        tasks(id, title, status, due_date, priority)
      )
    `)
    .eq('id', project_id)
    .single();

  if (projError) throw projError;

  // Get related projects in same department
  const { data: relatedProjects } = await supabase
    .from('projects')
    .select('id, name, status')
    .eq('team_id', project.team?.id)
    .neq('id', project_id);

  const context = {
    project: {
      id: project.id,
      name: project.name,
      description: project.description || '',
      status: project.status
    },
    team: {
      id: project.team?.id,
      name: project.team?.name,
      member_count: project.team?.members?.length || 0
    },
    department: {
      id: project.team?.department?.id,
      name: project.team?.department?.name
    },
    task_summary: {
      total: project.sections?.reduce((sum: number, s: any) => sum + (s.tasks?.length || 0), 0) || 0,
      in_progress: project.sections?.reduce((sum: number, s: any) =>
        sum + (s.tasks?.filter((t: any) => t.status === 'in_progress').length || 0), 0) || 0,
      blocked: project.sections?.reduce((sum: number, s: any) =>
        sum + (s.tasks?.filter((t: any) => t.status === 'blocked').length || 0), 0) || 0
    },
    related_projects: (relatedProjects || []).map((p: any) => ({
      id: p.id,
      name: p.name,
      status: p.status
    }))
  };

  return encodeToon({
    project_info: context.project,
    team_info: context.team,
    department_info: context.department,
    task_summary: context.task_summary,
    related_projects: context.related_projects
  });
}

async function executeGetDependencyChain(
  supabase: any,
  params: { task_id: string; direction: string }
): Promise<string> {
  const { task_id, direction } = params;

  const dependencies: any[] = [];

  // Get upstream (tasks that this task depends on)
  if (direction === 'upstream' || direction === 'both') {
    const { data: upstream } = await supabase
      .from('task_dependencies')
      .select(`
        dependency:tasks!task_dependencies_dependency_id_fkey(
          id, title, status, due_date,
          section:sections(project:projects(team:teams(department:departments(name))))
        )
      `)
      .eq('task_id', task_id);

    (upstream || []).forEach((d: any) => {
      if (d.dependency) {
        dependencies.push({
          id: d.dependency.id,
          title: d.dependency.title,
          status: d.dependency.status,
          due_date: d.dependency.due_date || 'none',
          department: d.dependency.section?.project?.team?.department?.name || 'unknown',
          relation: 'upstream'
        });
      }
    });
  }

  // Get downstream (tasks that depend on this task)
  if (direction === 'downstream' || direction === 'both') {
    const { data: downstream } = await supabase
      .from('task_dependencies')
      .select(`
        task:tasks!task_dependencies_task_id_fkey(
          id, title, status, due_date,
          section:sections(project:projects(team:teams(department:departments(name))))
        )
      `)
      .eq('dependency_id', task_id);

    (downstream || []).forEach((d: any) => {
      if (d.task) {
        dependencies.push({
          id: d.task.id,
          title: d.task.title,
          status: d.task.status,
          due_date: d.task.due_date || 'none',
          department: d.task.section?.project?.team?.department?.name || 'unknown',
          relation: 'downstream'
        });
      }
    });
  }

  return encodeToon({ dependency_chain: dependencies });
}

async function executeCheckTeamWorkload(
  supabase: any,
  params: { team_id: string; date: string; range_days?: number }
): Promise<string> {
  const { team_id, date, range_days = 7 } = params;

  const targetDate = new Date(date);
  const startDate = new Date(targetDate);
  startDate.setDate(startDate.getDate() - range_days);
  const endDate = new Date(targetDate);
  endDate.setDate(endDate.getDate() + range_days);

  // Get team's tasks in date range
  const { data: tasks } = await supabase
    .from('tasks')
    .select(`
      id, title, status, due_date, priority,
      section:sections!inner(
        project:projects!inner(team_id)
      )
    `)
    .eq('section.project.team_id', team_id)
    .gte('due_date', startDate.toISOString().split('T')[0])
    .lte('due_date', endDate.toISOString().split('T')[0]);

  // Get team members
  const { data: members } = await supabase
    .from('members')
    .select('id, name')
    .eq('team_id', team_id);

  const workload = {
    team_id,
    date_range: `${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`,
    member_count: members?.length || 0,
    task_count: tasks?.length || 0,
    high_priority_count: tasks?.filter((t: any) => t.priority === 'high' || t.priority === 'critical').length || 0,
    tasks_on_target_date: tasks?.filter((t: any) => t.due_date === date).length || 0
  };

  const taskList = (tasks || []).slice(0, 20).map((t: any) => ({
    id: t.id,
    title: t.title,
    due_date: t.due_date,
    priority: t.priority || 'medium',
    status: t.status
  }));

  return encodeToon({
    workload_summary: workload,
    upcoming_tasks: taskList
  });
}

async function executeTool(supabase: any, toolName: string, toolInput: any): Promise<string> {
  switch (toolName) {
    case 'search_related_tasks':
      return await executeSearchRelatedTasks(supabase, toolInput);
    case 'get_project_context':
      return await executeGetProjectContext(supabase, toolInput);
    case 'get_dependency_chain':
      return await executeGetDependencyChain(supabase, toolInput);
    case 'check_team_workload':
      return await executeCheckTeamWorkload(supabase, toolInput);
    default:
      return `Unknown tool: ${toolName}`;
  }
}

// ===========================================
// Main Handler
// ===========================================

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { task, projectId, sectionId } = await req.json();

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get project context for the new task
    const { data: project } = await supabase
      .from('projects')
      .select(`
        id, name,
        team:teams!inner(
          id, name,
          department:departments!inner(id, name)
        )
      `)
      .eq('id', projectId)
      .single();

    // Get existing tasks in same section for duplicate check
    const { data: existingTasks } = await supabase
      .from('tasks')
      .select('id, title')
      .eq('section_id', sectionId);

    // Basic duplicate detection (always run)
    const duplicates = (existingTasks || [])
      .filter((t: any) => {
        const similarity = calculateSimilarity(task.title, t.title);
        return similarity > 0.7;
      })
      .map((t: any) => ({
        id: t.id,
        title: t.title,
        similarity: Math.round(calculateSimilarity(task.title, t.title) * 100) + '%'
      }));

    // If no API key, return basic validation only
    if (!anthropicKey) {
      return new Response(JSON.stringify({
        valid: duplicates.length === 0,
        duplicates,
        conflicts: [],
        suggestions: duplicates.length > 0
          ? ['Similar task already exists. Consider updating the existing task instead.']
          : [],
        ai_analysis: null,
        mode: 'basic'
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Prepare initial context as TOON
    const newTaskToon = encodeToon({
      new_task: {
        title: task.title,
        due_date: task.due_date || 'not_set',
        priority: task.priority || 'medium'
      },
      context: {
        project: project?.name || 'unknown',
        team: project?.team?.name || 'unknown',
        department: project?.team?.department?.name || 'unknown',
        department_id: project?.team?.department?.id || ''
      }
    });

    // System prompt for Claude
    const systemPrompt = `You are an AI assistant that validates new tasks in a project management system.
Your job is to identify potential conflicts, duplicates, and issues with new tasks.

You have access to the following tools to gather information:
- search_related_tasks: Search for tasks that may conflict with the new task
- get_project_context: Get detailed project information
- get_dependency_chain: Analyze task dependencies
- check_team_workload: Check team capacity around a date

IMPORTANT: Use the tools to gather enough context before making your analysis.
For example:
1. Search for tasks with similar keywords or related themes
2. Check for tasks around the same due date in other departments
3. Look for potential timeline conflicts (e.g., marketing announcing before dev completes)

After gathering information, provide your final analysis in this TOON format:

\`\`\`toon
validation_result{valid,confidence}:
  [true/false]\t[0-100]

conflicts[N]{task_id,department,conflict_type,severity,message}:
  [each conflict on a new line, tab-separated]

suggestions[N]{priority,suggestion}:
  [each suggestion on a new line, tab-separated]

analysis{summary}:
  [brief analysis in one line]
\`\`\`

conflict_type can be: timeline, resource, dependency, semantic
severity can be: critical, high, medium, low`;

    // Initial message with TOON context
    const userMessage = `Validate this new task:

\`\`\`toon
${newTaskToon}
\`\`\`

${duplicates.length > 0 ? `
Note: Basic duplicate check found similar tasks:
${duplicates.map(d => `- "${d.title}" (${d.similarity} similar)`).join('\n')}
` : ''}

Use the available tools to check for:
1. Timeline conflicts with other departments (especially around the due date)
2. Resource conflicts
3. Dependency issues
4. Semantic conflicts (e.g., dev completion vs marketing announcement timing)`;

    // Claude API call with Tool Use loop
    const messages: any[] = [{ role: "user", content: userMessage }];
    let maxIterations = 6;
    let finalResponse: any = null;

    while (maxIterations > 0) {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 4096,
          system: systemPrompt,
          tools,
          messages
        })
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Anthropic API error: ${error}`);
      }

      const result = await response.json();

      // Add assistant response to messages
      messages.push({ role: "assistant", content: result.content });

      // Check if we need to execute tools
      if (result.stop_reason === "tool_use") {
        const toolResults: any[] = [];

        for (const block of result.content) {
          if (block.type === "tool_use") {
            console.log(`Executing tool: ${block.name}`, block.input);
            const toolResult = await executeTool(supabase, block.name, block.input);
            toolResults.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: toolResult
            });
          }
        }

        messages.push({ role: "user", content: toolResults });
        maxIterations--;
      } else {
        // End turn - we have our final response
        finalResponse = result;
        break;
      }
    }

    // Parse the final response
    let aiAnalysis = '';
    let conflicts: any[] = [];
    let suggestions: any[] = [];
    let valid = true;
    let confidence = 0;

    if (finalResponse) {
      for (const block of finalResponse.content) {
        if (block.type === "text") {
          aiAnalysis = block.text;

          // Extract TOON block from response
          const toonMatch = block.text.match(/```toon\n([\s\S]*?)\n```/);
          if (toonMatch) {
            const parsed = decodeToon(toonMatch[1]);

            if (parsed.validation_result) {
              valid = parsed.validation_result.valid === 'true' || parsed.validation_result.valid === true;
              confidence = parseInt(parsed.validation_result.confidence) || 0;
            }

            if (parsed.conflicts) {
              conflicts = Array.isArray(parsed.conflicts) ? parsed.conflicts : [parsed.conflicts];
            }

            if (parsed.suggestions) {
              suggestions = Array.isArray(parsed.suggestions) ? parsed.suggestions : [parsed.suggestions];
            }
          }
        }
      }
    }

    // Combine with basic validation
    const allConflicts = [
      ...duplicates.map(d => ({
        task_id: d.id,
        task_title: d.title,
        department: project?.team?.department?.name || 'same',
        conflict_type: 'duplicate',
        severity: 'medium',
        message: `Similar task exists: ${d.title} (${d.similarity} similar)`
      })),
      ...conflicts.map((c: any) => ({
        task_id: c.task_id || '',
        task_title: c.task_title || '',
        department: c.department || '',
        conflict_type: c.conflict_type || 'unknown',
        severity: c.severity || 'medium',
        message: c.message || ''
      }))
    ];

    const allSuggestions = suggestions.map((s: any) =>
      typeof s === 'string' ? s : s.suggestion || ''
    ).filter(Boolean);

    return new Response(JSON.stringify({
      valid: valid && duplicates.length === 0,
      confidence,
      duplicates,
      conflicts: allConflicts,
      suggestions: allSuggestions,
      ai_analysis: aiAnalysis,
      mode: 'ai_enhanced'
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({
      error: error.message,
      valid: false,
      duplicates: [],
      conflicts: [],
      suggestions: ['Validation failed. Please try again.']
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});

// Simple string similarity (Jaccard index on words)
function calculateSimilarity(str1: string, str2: string): number {
  const words1 = new Set(str1.toLowerCase().split(/\s+/));
  const words2 = new Set(str2.toLowerCase().split(/\s+/));

  const intersection = new Set([...words1].filter(x => words2.has(x)));
  const union = new Set([...words1, ...words2]);

  return intersection.size / union.size;
}
