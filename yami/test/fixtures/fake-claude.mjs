#!/usr/bin/env node
// A scripted Claude Code CLI for the adapter tests: it speaks the stream-json protocol of the Agent SDK.
// The prompt of each user message picks the turn.
import { createInterface } from 'node:readline';

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const session_id = 'fake-session';
let tool = 0;

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
  // `bad-result`: a result with no usage, which the adapter cannot read.
  if (prompt === 'bad-result') return send({ type: 'result', subtype: 'success', is_error: false, result: '', session_id, uuid: 'r' });
  assistant([{ type: 'text', text: `echo: ${prompt}` }]);
  result(`echo: ${prompt}`);
}

createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line);
  if (message.type === 'control_request') {
    const response = message.request.subtype === 'initialize'
      ? { commands: [], agents: [], output_style: 'default', available_output_styles: [], models: [], account: { email: 'test@example.com' } }
      : {};
    send({ type: 'control_response', response: { subtype: 'success', request_id: message.request_id, response } });
  } else if (message.type === 'user') {
    const content = message.message.content;
    turn(typeof content === 'string' ? content : content.map((part) => part.text ?? '').join(''));
  }
});
