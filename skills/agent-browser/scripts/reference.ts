const sections: Record<string, string> = {
  install: `npm install -g agent-browser
agent-browser install
agent-browser install --with-deps

git clone https://github.com/vercel-labs/agent-browser
cd agent-browser
pnpm install
pnpm build
agent-browser install`,
  quickstart: `agent-browser open <url>
agent-browser snapshot -i
agent-browser click @e1
agent-browser fill @e2 "text"
agent-browser close`,
  navigation: `agent-browser open <url>
agent-browser back
agent-browser forward
agent-browser reload
agent-browser close`,
  snapshot: `agent-browser snapshot
agent-browser snapshot -i
agent-browser snapshot -c
agent-browser snapshot -d 3
agent-browser snapshot -s "#main"`,
  interactions: `agent-browser click @e1
agent-browser dblclick @e1
agent-browser focus @e1
agent-browser fill @e2 "text"
agent-browser type @e2 "text"
agent-browser press Enter
agent-browser press Control+a
agent-browser keydown Shift
agent-browser keyup Shift
agent-browser hover @e1
agent-browser check @e1
agent-browser uncheck @e1
agent-browser select @e1 "value"
agent-browser scroll down 500
agent-browser scrollintoview @e1
agent-browser drag @e1 @e2
agent-browser upload @e1 file.pdf`,
  get: `agent-browser get text @e1
agent-browser get html @e1
agent-browser get value @e1
agent-browser get attr @e1 href
agent-browser get title
agent-browser get url
agent-browser get count ".item"
agent-browser get box @e1`,
  wait: `agent-browser wait @e1
agent-browser wait 2000
agent-browser wait --text "Success"
agent-browser wait --url "/dashboard"
agent-browser wait --load networkidle
agent-browser wait --fn "window.ready"`,
  debugging: `agent-browser open example.com --headed
agent-browser console
agent-browser console --clear
agent-browser errors
agent-browser errors --clear
agent-browser highlight @e1
agent-browser trace start
agent-browser trace stop trace.zip
agent-browser record start ./debug.webm
agent-browser record stop
agent-browser --cdp 9222 snapshot`,
  options: `--session
--json
--full
--headed
--timeout
--cdp`,
};

const args = process.argv.slice(2);
const topicArg = args.find((a) => a.startsWith("--topic="))?.slice("--topic=".length) ?? "all";
const topic = topicArg.trim().toLowerCase();

let content: string;
if (topic === "all") {
  content = Object.entries(sections)
    .map(([name, text]) => `## ${name}\n${text}`)
    .join("\n\n");
} else {
  content = sections[topic] ?? `Unknown topic "${topic}". Available: ${Object.keys(sections).join(", ")}, all`;
}

console.log(
  JSON.stringify({
    topic,
    content,
  })
);
