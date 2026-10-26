# inline-images

A Claude Code mod that draws images where they live in the conversation: under the tool call that returned them, or under the prompt you pasted them into.

![Images drawn inline in a Claude Code session](docs/demo.png)

## Install

```text
/plugin install inline-images --marketplace SergioGhisler/cc-inline-images-mod
```

Needs a kitty-graphics terminal and ImageMagick for non-PNG images.
In terminals Claude Code does not recognise (Herdr, WezTerm), add this to `~/.claude/settings.json`:

```json
{ "env": { "CLAUDE_CODE_FORCE_TERMINAL_IMAGES": "1" } }
```

## License

[MIT](LICENSE)
