# Liquidsoap for Nova

Liquidsoap language support for [Panic's Nova editor](https://nova.app), ported from the official [vscode-liquidsoap](https://github.com/savonet/vscode-liquidsoap) extension maintained by Savonet.

This extension is not maintained by Savonet.

## Features

- Syntax highlighting
- Autocomplete (functions, keywords, types, encoders, preprocessor directives)
- Syntax validation (unclosed blocks, mismatched brackets, unclosed strings)
- Code formatting via [prettier](https://prettier.io/) + [liquidsoap-prettier](https://github.com/savonet/liquidsoap-prettier) (`Opt+Shift+F` or on save)
- Automatic indentation
- Code folding

## Installation

### The Nova way
Install this from the Extension library.

### The easy way
Double-click the extension.

### The hard way
Symlink the extension bundle into Nova's extensions directory:

```
ln -s /path/to/Liquidsoap.novaextension \
  ~/Library/Application\ Support/Nova/Extensions/Liquidsoap.novaextension
```

Restart Nova. Any `.liq` file will activate the extension.

Formatting requires `prettier` and `liquidsoap-prettier` — either globally or in your project's `node_modules`.

## Issues
You're welcome to [submit](https://github.com/MikaSappi/liquidsoap-nova/issues) any issues you may find in this product.

## License

MIT
