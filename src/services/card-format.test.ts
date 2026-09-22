import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';

import {
	parseCard,
	detectFormat,
	serializeCard,
	updateSyncLine,
	formatSyncLine,
} from './card-format';
import { computeContentHash } from '../utils/hash';
import { ANKI_BLOCK_REGEX } from '../utils/constants';

const BASIC = `deck: Programming
model: Basic

[Front]
What is 2+2?

[Back]
4`;

describe('detectFormat', () => {
	test('a [Section] line means box format', () => {
		assert.equal(detectFormat(BASIC), 'box');
	});

	test('a leading brace means JSON', () => {
		assert.equal(detectFormat('{\n "deck": "D"\n}'), 'json');
	});

	test('anything else is treated as legacy YAML', () => {
		assert.equal(detectFormat('deck: D\nfields:\n  Front: |\n    hi'), 'yaml');
	});
});

describe('box parsing', () => {
	test('reads header and field boxes', () => {
		const result = parseCard(BASIC);
		assert.equal(result.success, true, result.error);
		assert.equal(result.data?.deck, 'Programming');
		assert.equal(result.data?.model, 'Basic');
		assert.deepEqual(result.data?.fields, { Front: 'What is 2+2?', Back: '4' });
	});

	test('field bodies keep blank lines and nested code fences verbatim', () => {
		const source = `deck: D
model: Basic

[Front]
Explain this:

\`\`\`python
def f():
    return 1
\`\`\`

Why?

[Back]
Because.`;
		const result = parseCard(source);
		assert.equal(result.success, true, result.error);
		assert.equal(
			result.data?.fields['Front'],
			'Explain this:\n\n```python\ndef f():\n    return 1\n```\n\nWhy?',
		);
	});

	test('header values are never type-coerced', () => {
		// These are exactly the cases that broke under YAML.
		const result = parseCard('deck: 1.0\nmodel: Basic\n\n[Front]\nq\n\n[sync] id=1 rev=12e45678');
		assert.equal(result.success, true, result.error);
		assert.equal(result.data?.deck, '1.0');
		assert.equal(result.data?.lastSyncedHash, '12e45678');
	});

	test('a deck name containing a colon survives', () => {
		const result = parseCard('deck: Physics::Optics: Lenses\nmodel: Basic\n\n[Front]\nq');
		assert.equal(result.data?.deck, 'Physics::Optics: Lenses');
	});

	test('tags split on commas or whitespace', () => {
		assert.deepEqual(parseCard('deck: D\nmodel: M\ntags: a, b, c\n\n[Front]\nq').data?.tags, ['a', 'b', 'c']);
		assert.deepEqual(parseCard('deck: D\nmodel: M\ntags: [a, b]\n\n[Front]\nq').data?.tags, ['a', 'b']);
		assert.deepEqual(parseCard('deck: D\nmodel: M\ntags:\n\n[Front]\nq').data?.tags, []);
	});

	test('unknown header keys are preserved', () => {
		const result = parseCard('deck: D\nmodel: M\nsource: textbook p42\n\n[Front]\nq');
		assert.deepEqual(result.data?.extra, { source: 'textbook p42' });
	});

	test('reads the sync line', () => {
		const result = parseCard(`${BASIC}\n\n[sync] id=1748291045821 rev=a3f9c1`);
		assert.equal(result.data?.noteId, 1748291045821);
		assert.equal(result.data?.lastSyncedHash, 'a3f9c1');
	});

	test('a literal [Foo] line in a body can be escaped', () => {
		const result = parseCard('deck: D\nmodel: M\n\n[Front]\n\\[Not a box]\nreal content');
		assert.equal(result.data?.fields['Front'], '[Not a box]\nreal content');
	});

	test('arbitrary field names work (custom note types)', () => {
		const result = parseCard('deck: D\nmodel: Japanese Vocab\n\n[Expression]\n猫\n\n[Reading]\nねこ\n\n[Meaning]\ncat');
		assert.deepEqual(Object.keys(result.data!.fields), ['Expression', 'Reading', 'Meaning']);
	});

	test('rejects a block with no boxes', () => {
		const result = parseCard('deck: D\nmodel: M');
		assert.equal(result.success, false);
		assert.match(result.error!, /at least one field box/);
	});

	test('a [sync] line in field content can be escaped', () => {
		const card = parseCard('deck: D\nmodel: M\n\n[Front]\n\\[sync] id=fake\nreal').data!;
		assert.equal(card.fields['Front'], '[sync] id=fake\nreal');
		assert.equal(card.noteId, null);
		assert.deepEqual(parseCard(serializeCard(card)).data, card);
	});

	test('rejects a malformed header line with a line number', () => {
		const result = parseCard('deck: D\nthis is not a header\n\n[Front]\nq');
		assert.equal(result.success, false);
		assert.match(result.error!, /Line 2/);
	});

	test('requires deck and model', () => {
		assert.match(parseCard('model: M\n\n[Front]\nq').error!, /deck is required/);
		assert.match(parseCard('deck: D\n\n[Front]\nq').error!, /model is required/);
	});
});

describe('legacy formats still parse', () => {
	test('YAML with block scalars', () => {
		const source = `deck: Programming
model: Basic
fields:
  Front: |
    What is 2+2?

    With a blank line.
  Back: |
    4
tags: [math, easy]
noteId: 1234567890
lastSyncedHash: abc123`;
		const result = parseCard(source);
		assert.equal(result.success, true, result.error);
		assert.equal(result.format, 'yaml');
		assert.equal(result.data?.deck, 'Programming');
		assert.equal(result.data?.fields['Front'], 'What is 2+2?\n\nWith a blank line.');
		assert.equal(result.data?.fields['Back'], '4');
		assert.deepEqual(result.data?.tags, ['math', 'easy']);
		assert.equal(result.data?.noteId, 1234567890);
		assert.equal(result.data?.lastSyncedHash, 'abc123');
	});

	test('JSON', () => {
		const result = parseCard('{"deck":"D","model":"Basic","fields":{"Front":"q","Back":"a"},"tags":["t"],"noteId":null}');
		assert.equal(result.success, true, result.error);
		assert.equal(result.format, 'json');
		assert.equal(result.data?.noteId, null);
		assert.deepEqual(result.data?.fields, { Front: 'q', Back: 'a' });
	});
});

describe('serializing', () => {
	test('round-trips a card', () => {
		const original = parseCard(`${BASIC}\n\n[sync] id=99 rev=deadbe`).data!;
		const reparsed = parseCard(serializeCard(original)).data!;
		assert.deepEqual(reparsed, original);
	});

	test('round-trips content that looks like a box marker', () => {
		const card = parseCard('deck: D\nmodel: M\n\n[Front]\n\\[Verse 1]\nlyrics').data!;
		const reparsed = parseCard(serializeCard(card)).data!;
		assert.deepEqual(reparsed.fields, card.fields);
	});

	test('round-trips a legacy YAML card into box format', () => {
		const legacy = parseCard('deck: D\nmodel: Basic\nfields:\n  Front: |\n    q\n  Back: |\n    a\nnoteId: 7').data!;
		const migrated = serializeCard(legacy);
		assert.match(migrated, /^\[Front\]$/m);
		assert.deepEqual(parseCard(migrated).data, legacy);
	});

	test('omits the sync line for an unsynced card', () => {
		assert.equal(formatSyncLine(null, undefined), null);
		assert.doesNotMatch(serializeCard(parseCard(BASIC).data!), /\[sync\]/);
	});
});

describe('updateSyncLine leaves everything else untouched', () => {
	test('appends when absent', () => {
		const updated = updateSyncLine(BASIC, 42, 'ff00');
		assert.equal(updated, `${BASIC}\n\n[sync] id=42 rev=ff00`);
	});

	test('replaces in place when present', () => {
		const withSync = `${BASIC}\n\n[sync] id=42 rev=ff00`;
		assert.equal(updateSyncLine(withSync, 42, 'aaaa'), `${BASIC}\n\n[sync] id=42 rev=aaaa`);
	});

	test('preserves comments, spacing and unknown keys byte for byte', () => {
		const messy = `deck: D
source: my notes
model: Basic


[Front]
q


[Back]
a

[sync] id=1 rev=old`;
		const updated = updateSyncLine(messy, 1, 'new');
		assert.equal(updated, messy.replace('rev=old', 'rev=new'));
	});
});

describe('content hash', () => {
	const base = { deck: 'D', model: 'Basic', fields: { Front: 'q' }, tags: ['a'] };

	test('changes when tags change', () => {
		assert.notEqual(computeContentHash(base), computeContentHash({ ...base, tags: ['a', 'b'] }));
	});

	test('changes when tags are cleared', () => {
		assert.notEqual(computeContentHash(base), computeContentHash({ ...base, tags: [] }));
	});

	test('changes when model changes', () => {
		assert.notEqual(computeContentHash(base), computeContentHash({ ...base, model: 'Cloze' }));
	});

	test('is stable across field and tag ordering', () => {
		const a = { deck: 'D', model: 'M', fields: { A: '1', B: '2' }, tags: ['x', 'y'] };
		const b = { deck: 'D', model: 'M', fields: { B: '2', A: '1' }, tags: ['y', 'x'] };
		assert.equal(computeContentHash(a), computeContentHash(b));
	});
});

describe('fence matching', () => {
	function findAll(content: string) {
		const re = new RegExp(ANKI_BLOCK_REGEX);
		const out: string[] = [];
		let m: RegExpExecArray | null;
		while ((m = re.exec(content)) !== null) out.push(m[3]!.replace(/\n$/, ''));
		return out;
	}

	test('matches tilde fences', () => {
		assert.deepEqual(findAll('text\n~~~anki\nbody\n~~~\nmore'), ['body']);
	});

	test('matches legacy five-backtick fences', () => {
		assert.deepEqual(findAll('```` `\n`````anki\nbody\n`````\n'.replace('```` `\n', '')), ['body']);
	});

	test('matches three-backtick fences too, so they no longer sync silently', () => {
		assert.deepEqual(findAll('```anki\nbody\n```'), ['body']);
	});

	test('a tilde fence survives nested backtick code blocks', () => {
		const content = '~~~anki\ndeck: D\n\n[Front]\n```python\nx = 1\n```\n~~~';
		assert.deepEqual(findAll(content), ['deck: D\n\n[Front]\n```python\nx = 1\n```']);
	});

	test('finds several blocks in one file', () => {
		assert.deepEqual(findAll('~~~anki\none\n~~~\n\ntext\n\n~~~anki\ntwo\n~~~'), ['one', 'two']);
	});
});
