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

    const schema = parseSchema(trimmed);
    if (schema) {
      if (currentSchema) {
        result[currentSchema.name] = currentSchema.isArray ? currentData : currentData[0];
      }
      currentSchema = schema;
      currentData = [];
      continue;
    }

    if (currentSchema && line.startsWith('  ')) {
      const values = trimmed.split('\t');
      const obj: Record<string, any> = {};
      currentSchema.fields.forEach((field, i) => {
        let val: any = values[i] ?? '';
        if (/^-?\d+$/.test(val)) val = parseInt(val);
        else if (/^-?\d+\.\d+$/.test(val)) val = parseFloat(val);
        obj[field] = val;
      });
      currentData.push(obj);
    }
  }

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
    name: "get_task_details",
    description: "Get full details of a task including its context",
    input_schema: {
      type: "object",
      properties: {
        task_id: {
          type: "string",
          description: "The task ID to get details for"
        }
      },
      required: ["task_id"]
    }
  },
  {
    name: "get_dependency_chain",
    description: "Get tasks that depend on or are depended upon by a task",
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
          description: "Direction of dependencies"
        },
        depth: {
          type: "number",
          description: "How many levels deep to traverse (default: 3)"
        }
      },
      required: ["task_id", "direction"]
    }
  },
  {
    name: "search_affected_tasks",
    description: "Search for tasks that might be affected by a change",
    input_schema: {
      type: "object",
      properties: {
        keywords: {
          type: "array",
          items: { type: "string" },
          description: "Keywords related to the changed task"
        },
        date_after: {
          type: "string",
          description: "Only tasks due after this date (YYYY-MM-DD)"
        },
        exclude_task_id: {
          type: "string",
          description: "Task ID to exclude from results"
        }
      },
      required: ["keywords"]
    }
  },
  {
    name: "get_department_tasks",
    description: "Get all active tasks for a specific department",
    input_schema: {
      type: "object",
      properties: {
        department_id: {
          type: "string",
          description: "The department ID"
        },
        include_upcoming_only: {
          type: "boolean",
          description: "Only include tasks with future due dates"
        }
      },
      required: ["department_id"]
    }
  },
  {
    name: "get_change_history",
    description: "Get recent change history for a task",
    input_schema: {
      type: "object",
      properties: {
        task_id: {
          type: "string",
          description: "The task ID"
        },
        limit: {
          type: "number",
          description: "Number of changes to retrieve (default: 10)"
        }
      },
      required: ["task_id"]
    }
  }
];

// ===========================================
// Tool Execution Functions
// ===========================================

async function executeGetTaskDetails(
  supabase: any,
  params: { task_id: string }
): Promise<string> {
  const { task_id } = params;

  const { data: task, error } = await supabase
    .from('tasks')
    .select(`
      id, title, description, status, priority, due_date, created_at, updated_at,
      assignee:members(id, name, role),
      section:sections!inner(
        id, name,
        project:projects!inner(
          id, name, status,
          team:teams!inner(
            id, name,
            department:departments!inner(id, name)
          )
        )
      )
    `)
    .eq('id', task_id)
    .single();

  if (error) throw error;

  const formatted = {
    task: {
      id: task.id,
      title: task.title,
      description: task.description || '',
      status: task.status,
      priority: task.priority || 'medium',
      due_date: task.due_date || 'not_set'
    },
    assignee: task.assignee ? {
      id: task.assignee.id,
      name: task.assignee.name,
      role: task.assignee.role || ''
    } : null,
    context: {
      section: task.section?.name || '',
      project: task.section?.project?.name || '',
      team: task.section?.project?.team?.name || '',
      department: task.section?.project?.team?.department?.name || '',
      department_id: task.section?.project?.team?.department?.id || ''
    }
  };

  return encodeToon({
    task_details: formatted.task,
    assignee: formatted.assignee || { id: 'none', name: 'unassigned', role: '' },
    context: formatted.context
  });
}

async function executeGetDependencyChain(
  supabase: any,
  params: { task_id: string; direction: string; depth?: number }
): Promise<string> {
  const { task_id, direction, depth = 3 } = params;

  const visited = new Set<string>();
  const allDependencies: any[] = [];

  async function traverse(currentId: string, currentDepth: number, relation: string) {
    if (currentDepth > depth || visited.has(currentId)) return;
    visited.add(currentId);

    if (direction === 'upstream' || direction === 'both') {
      const { data: upstream } = await supabase
        .from('task_dependencies')
        .select(`
          dependency:tasks!task_dependencies_dependency_id_fkey(
            id, title, status, due_date, priority,
            section:sections(project:projects(team:teams(department:departments(id, name))))
          )
        `)
        .eq('task_id', currentId);

      for (const d of upstream || []) {
        if (d.dependency && !visited.has(d.dependency.id)) {
          allDependencies.push({
            id: d.dependency.id,
            title: d.dependency.title,
            status: d.dependency.status,
            due_date: d.dependency.due_date || 'none',
            priority: d.dependency.priority || 'medium',
            department: d.dependency.section?.project?.team?.department?.name || 'unknown',
            relation: 'upstream',
            depth: currentDepth
          });
          await traverse(d.dependency.id, currentDepth + 1, 'upstream');
        }
      }
    }

    if (direction === 'downstream' || direction === 'both') {
      const { data: downstream } = await supabase
        .from('task_dependencies')
        .select(`
          task:tasks!task_dependencies_task_id_fkey(
            id, title, status, due_date, priority,
            section:sections(project:projects(team:teams(department:departments(id, name))))
          )
        `)
        .eq('dependency_id', currentId);

      for (const d of downstream || []) {
        if (d.task && !visited.has(d.task.id)) {
          allDependencies.push({
            id: d.task.id,
            title: d.task.title,
            status: d.task.status,
            due_date: d.task.due_date || 'none',
            priority: d.task.priority || 'medium',
            department: d.task.section?.project?.team?.department?.name || 'unknown',
            relation: 'downstream',
            depth: currentDepth
          });
          await traverse(d.task.id, currentDepth + 1, 'downstream');
        }
      }
    }
  }

  await traverse(task_id, 1, direction);

  return encodeToon({
    dependency_chain: allDependencies,
    summary: {
      total: allDependencies.length,
      upstream_count: allDependencies.filter(d => d.relation === 'upstream').length,
      downstream_count: allDependencies.filter(d => d.relation === 'downstream').length,
      cross_department: allDependencies.filter((d, i, arr) => {
        const depts = new Set(arr.map(x => x.department));
        return depts.size > 1;
      }).length > 0 ? 'yes' : 'no'
    }
  });
}

async function executeSearchAffectedTasks(
  supabase: any,
  params: { keywords: string[]; date_after?: string; exclude_task_id?: string }
): Promise<string> {
  const { keywords, date_after, exclude_task_id } = params;

  let query = supabase
    .from('tasks')
    .select(`
      id, title, status, due_date, priority,
      section:sections!inner(
        project:projects!inner(
          team:teams!inner(
            department:departments!inner(id, name)
          )
        )
      )
    `)
    .neq('status', 'done');

  if (date_after) {
    query = query.gte('due_date', date_after);
  }

  if (exclude_task_id) {
    query = query.neq('id', exclude_task_id);
  }

  const { data: allTasks, error } = await query;
  if (error) throw error;

  const keywordLower = keywords.map(k => k.toLowerCase());
  const matchedTasks = (allTasks || []).filter((task: any) => {
    const titleLower = task.title.toLowerCase();
    return keywordLower.some(kw => titleLower.includes(kw));
  });

  const formatted = matchedTasks.slice(0, 25).map((t: any) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    due_date: t.due_date || 'none',
    priority: t.priority || 'medium',
    department: t.section?.project?.team?.department?.name || 'unknown'
  }));

  return encodeToon({ affected_tasks: formatted });
}

async function executeGetDepartmentTasks(
  supabase: any,
  params: { department_id: string; include_upcoming_only?: boolean }
): Promise<string> {
  const { department_id, include_upcoming_only } = params;

  let query = supabase
    .from('tasks')
    .select(`
      id, title, status, due_date, priority,
      section:sections!inner(
        project:projects!inner(
          name,
          team:teams!inner(
            department_id
          )
        )
      )
    `)
    .eq('section.project.team.department_id', department_id)
    .neq('status', 'done');

  if (include_upcoming_only) {
    const today = new Date().toISOString().split('T')[0];
    query = query.gte('due_date', today);
  }

  const { data: tasks, error } = await query.order('due_date');
  if (error) throw error;

  const formatted = (tasks || []).slice(0, 30).map((t: any) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    due_date: t.due_date || 'none',
    priority: t.priority || 'medium',
    project: t.section?.project?.name || 'unknown'
  }));

  return encodeToon({ department_tasks: formatted });
}

async function executeGetChangeHistory(
  supabase: any,
  params: { task_id: string; limit?: number }
): Promise<string> {
  const { task_id, limit = 10 } = params;

  const { data: changes, error } = await supabase
    .from('task_changes')
    .select('*')
    .eq('task_id', task_id)
    .order('changed_at', { ascending: false })
    .limit(limit);

  if (error) throw error;

  const formatted = (changes || []).map((c: any) => ({
    id: c.id,
    change_type: c.change_type,
    old_value: String(c.old_value || ''),
    new_value: String(c.new_value || ''),
    changed_at: c.changed_at
  }));

  return encodeToon({ change_history: formatted });
}

async function executeTool(supabase: any, toolName: string, toolInput: any): Promise<string> {
  switch (toolName) {
    case 'get_task_details':
      return await executeGetTaskDetails(supabase, toolInput);
    case 'get_dependency_chain':
      return await executeGetDependencyChain(supabase, toolInput);
    case 'search_affected_tasks':
      return await executeSearchAffectedTasks(supabase, toolInput);
    case 'get_department_tasks':
      return await executeGetDepartmentTasks(supabase, toolInput);
    case 'get_change_history':
      return await executeGetChangeHistory(supabase, toolInput);
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
    const { taskId, changeType, oldValue, newValue } = await req.json();

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Record the change
    const { data: changeRecord, error: changeError } = await supabase
      .from('task_changes')
      .insert({
        task_id: taskId,
        change_type: changeType,
        old_value: oldValue,
        new_value: newValue,
        changed_at: new Date().toISOString()
      })
      .select()
      .single();

    if (changeError) {
      console.error('Failed to record change:', changeError);
    }

    // Get task details for context
    const { data: task } = await supabase
      .from('tasks')
      .select(`
        id, title, status, priority, due_date,
        section:sections!inner(
          project:projects!inner(
            id, name,
            team:teams!inner(
              id, name,
              department:departments!inner(id, name)
            )
          )
        )
      `)
      .eq('id', taskId)
      .single();

    // Basic severity calculation
    let baseSeverity: 'critical' | 'high' | 'medium' | 'low' = 'low';
    if (changeType === 'status' && newValue === 'blocked') {
      baseSeverity = 'high';
    } else if (changeType === 'status' && newValue === 'done') {
      baseSeverity = 'medium';
    } else if (changeType === 'due_date') {
      baseSeverity = 'medium';
    }

    // If no API key, return basic analysis
    if (!anthropicKey) {
      return new Response(JSON.stringify({
        task_id: taskId,
        change_type: changeType,
        severity: baseSeverity,
        analysis_id: changeRecord?.id || null,
        impacts: [],
        cross_department_alerts: [],
        recommendations: [],
        ai_analysis: null,
        mode: 'basic'
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Prepare change context as TOON
    const changeToon = encodeToon({
      change: {
        task_id: taskId,
        change_type: changeType,
        old_value: String(oldValue),
        new_value: String(newValue)
      },
      task_context: {
        title: task?.title || 'unknown',
        current_status: task?.status || 'unknown',
        priority: task?.priority || 'medium',
        due_date: task?.due_date || 'not_set',
        project: task?.section?.project?.name || 'unknown',
        team: task?.section?.project?.team?.name || 'unknown',
        department: task?.section?.project?.team?.department?.name || 'unknown',
        department_id: task?.section?.project?.team?.department?.id || ''
      }
    });

    // System prompt
    const systemPrompt = `You are an AI assistant that analyzes task changes in a project management system.
Your job is to identify the impact of changes on other tasks and teams.

You have access to tools to gather information:
- get_task_details: Get full task context
- get_dependency_chain: Find tasks that depend on or are depended upon by this task
- search_affected_tasks: Search for tasks that might be affected
- get_department_tasks: Get all tasks for a department
- get_change_history: Get recent changes to a task

IMPORTANT ANALYSIS POINTS:
1. If a task is blocked, check what downstream tasks depend on it
2. If a task is completed, check if downstream tasks can now proceed
3. If a due date changes, check for timeline conflicts
4. Look for cross-department impacts (hidden dependencies)

After analysis, provide your response in this TOON format:

\`\`\`toon
impact_summary{severity,confidence,summary}:
  [critical/high/medium/low]\t[0-100]\t[one line summary]

affected_tasks[N]{task_id,title,department,impact_type,delay_days,message}:
  [each affected task on a new line, tab-separated]

cross_department_alerts[N]{from_dept,to_dept,alert_type,urgency,message}:
  [each alert on a new line, tab-separated]

recommendations[N]{priority,action,target,reason}:
  [each recommendation on a new line, tab-separated]
\`\`\`

severity: critical (blocks major milestone), high (cross-department impact), medium (same-team impact), low (minor impact)
impact_type: blocked, delayed, needs_review, can_proceed
alert_type: timeline_conflict, resource_conflict, dependency_broken, milestone_at_risk`;

    const userMessage = `Analyze this task change:

\`\`\`toon
${changeToon}
\`\`\`

Use the tools to:
1. Get the full dependency chain for this task
2. Check for cross-department impacts
3. Identify any tasks that are now blocked or can proceed
4. Look for hidden dependencies (tasks with similar keywords/timing that aren't formally linked)`;

    // Claude API with Tool Use loop
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
      messages.push({ role: "assistant", content: result.content });

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
        finalResponse = result;
        break;
      }
    }

    // Parse final response
    let aiAnalysis = '';
    let impacts: any[] = [];
    let crossDepartmentAlerts: any[] = [];
    let recommendations: any[] = [];
    let severity = baseSeverity;
    let confidence = 0;
    let summary = '';

    if (finalResponse) {
      for (const block of finalResponse.content) {
        if (block.type === "text") {
          aiAnalysis = block.text;

          const toonMatch = block.text.match(/```toon\n([\s\S]*?)\n```/);
          if (toonMatch) {
            const parsed = decodeToon(toonMatch[1]);

            if (parsed.impact_summary) {
              severity = parsed.impact_summary.severity || baseSeverity;
              confidence = parseInt(parsed.impact_summary.confidence) || 0;
              summary = parsed.impact_summary.summary || '';
            }

            if (parsed.affected_tasks) {
              impacts = Array.isArray(parsed.affected_tasks)
                ? parsed.affected_tasks
                : [parsed.affected_tasks];
            }

            if (parsed.cross_department_alerts) {
              crossDepartmentAlerts = Array.isArray(parsed.cross_department_alerts)
                ? parsed.cross_department_alerts
                : [parsed.cross_department_alerts];
            }

            if (parsed.recommendations) {
              recommendations = Array.isArray(parsed.recommendations)
                ? parsed.recommendations
                : [parsed.recommendations];
            }
          }
        }
      }
    }

    // Save analysis to database
    const { data: analysisRecord } = await supabase
      .from('ai_dependency_analyses')
      .insert({
        trigger_task_id: taskId,
        trigger_change_type: changeType,
        analysis_result: {
          severity,
          confidence,
          summary,
          impacts,
          cross_department_alerts: crossDepartmentAlerts,
          recommendations
        },
        analyzed_at: new Date().toISOString()
      })
      .select()
      .single();

    // Create notifications for high-severity impacts
    if (severity === 'critical' || severity === 'high') {
      for (const alert of crossDepartmentAlerts) {
        await supabase.from('notifications').insert({
          type: 'cross_department_alert',
          title: `${alert.alert_type}: ${alert.from_dept} → ${alert.to_dept}`,
          message: alert.message,
          severity: alert.urgency || severity,
          related_task_id: taskId,
          created_at: new Date().toISOString()
        });
      }
    }

    return new Response(JSON.stringify({
      task_id: taskId,
      change_type: changeType,
      severity,
      confidence,
      summary,
      analysis_id: analysisRecord?.id || null,
      impacts: impacts.map((i: any) => ({
        task_id: i.task_id || '',
        task_title: i.title || '',
        department: i.department || '',
        impact_type: i.impact_type || 'unknown',
        delay_days: i.delay_days || 0,
        message: i.message || ''
      })),
      cross_department_alerts: crossDepartmentAlerts.map((a: any) => ({
        from_dept: a.from_dept || '',
        to_dept: a.to_dept || '',
        alert_type: a.alert_type || 'unknown',
        urgency: a.urgency || 'medium',
        message: a.message || ''
      })),
      recommendations: recommendations.map((r: any) => ({
        priority: r.priority || 0,
        action: r.action || '',
        target: r.target || '',
        reason: r.reason || ''
      })),
      ai_analysis: aiAnalysis,
      mode: 'ai_enhanced'
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({
      error: error.message,
      task_id: null,
      change_type: null,
      severity: 'low',
      impacts: [],
      cross_department_alerts: [],
      recommendations: []
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
