#!/usr/bin/env node
// A scripted Claude Code CLI for the adapter tests: it speaks the stream-json protocol of the Agent SDK.
// The prompt of each user message picks the turn.
import { createInterface } from 'node:readline';

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const session_id = 'fake-session';
let tool = 0;
let request = 0;
/** Permission requests that wait for the SDK's answer, by request id. */
const waiting = new Map();

function assistant(content) {
  send({ type: 'assistant', session_id, parent_tool_use_id: null, uuid: `a-${tool}`, message: { id: `m-${tool}`, type: 'message', role: 'assistant', model: 'fake', content, stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } });
}

function result(text) {
  send({ type: 'result', subtype: 'success', is_error: false, result: text, session_id, duration_ms: 1, duration_api_ms: 1, num_turns: 1, total_cost_usd: 0, usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, permission_denials: [], uuid: 'r' });
}

function turn(prompt) {
  send({ type: 'system', subtype: 'init', session_id, uuid: 'i', cwd: process.cwd(), tools: [], mcp_servers: [], model: 'fake', permissionMode: 'default', slash_commands: [], apiKeySource: 'none', output_style: 'default', skills: [], plugins: [] });
  // `tool <name> <json input>`: the model calls a tool with that input, as it sent it.
  const call = /^tool (\S+) (.*)$/s.exec(prompt);
  if (call) {
    tool += 1;
    assistant([{ type: 'tool_use', id: `t-${tool}`, name: call[1], input: JSON.parse(call[2]) }]);
    send({ type: 'user', session_id, parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `t-${tool}`, content: 'InputValidationError', is_error: true }] } });
  }
  // `args`: the reply is the CLI's arguments, so a test sees the options that the adapter gave.
  if (prompt === 'args') {
    assistant([{ type: 'text', text: process.argv.slice(2).join(' ') }]);
    return result(process.argv.slice(2).join(' '));
  }
  // `initialize`: the reply is the SDK's initialize request, so a test sees the options that go there, such as the system prompt.
  if (prompt === 'initialize') {
    const text = JSON.stringify(initialize);
    assistant([{ type: 'text', text }]);
    return result(text);
  }
  // `env <names>`: the reply is those variables of the CLI's environment, as JSON.
  if (prompt.startsWith('env ')) {
    const text = JSON.stringify(Object.fromEntries(prompt.split(' ').slice(1).map((name) => [name, process.env[name]])));
    assistant([{ type: 'text', text }]);
    return result(text);
  }
  // `permit <tool> <json input>`: Claude Code asks the SDK whether the tool may run, and the reply is the answer.
  // `permit-input` replies with the input that the answer lets the tool run with.
  const permit = /^permit(-input)? (\S+) (.*)$/s.exec(prompt);
  if (permit) {
    const request_id = `p-${++request}`;
    waiting.set(request_id, (answer) => {
      const text = permit[1]
        ? `permission: ${answer.behavior} ${JSON.stringify(answer.updatedInput)}`
        : `permission: ${answer.behavior}${answer.message ? `: ${answer.message}` : ''}`;
      assistant([{ type: 'text', text }]);
      result(text);
    });
    return send({ type: 'control_request', request_id, request: { subtype: 'can_use_tool', tool_name: permit[2], input: JSON.parse(permit[3]), tool_use_id: `t-${request_id}` } });
  }
  // `bad-result`: a result with no usage, which the adapter cannot read.
  if (prompt === 'bad-result') return send({ type: 'result', subtype: 'success', is_error: false, result: '', session_id, uuid: 'r' });
  assistant([{ type: 'text', text: `echo: ${prompt}` }]);
  result(`echo: ${prompt}`);
}

let initialize = {};
createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line);
  if (message.type === 'control_response') {
    const answer = waiting.get(message.response.request_id);
    waiting.delete(message.response.request_id);
    answer?.(message.response.response ?? {});
  } else if (message.type === 'control_request') {
    if (message.request.subtype === 'initialize') initialize = message.request;
    const response = message.request.subtype === 'initialize'
      ? { commands: [], agents: [], output_style: 'default', available_output_styles: [], models: [], account: { email: 'test@example.com' } }
      : {};
    send({ type: 'control_response', response: { subtype: 'success', request_id: message.request_id, response } });
  } else if (message.type === 'user') {
    const content = message.message.content;
    turn(typeof content === 'string' ? content : content.map((part) => part.text ?? '').join(''));
  }
});
