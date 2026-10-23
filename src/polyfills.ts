(Symbol as unknown as { metadata?: symbol }).metadata ??= Symbol.for('Symbol.metadata');
