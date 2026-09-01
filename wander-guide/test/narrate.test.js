'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const narrate = require('../src/narrate');

describe('narrate', () => {
  it('builds a compact area label', () => {
    const here = narrate.formatHere({
      neighbourhood: 'Fisherman\'s Wharf',
      city: 'San Francisco',
      state: 'California',
      country: 'United States',
    }, 'ignored');
    assert.equal(here.label, "Fisherman's Wharf, San Francisco, California");
    assert.equal(narrate.spokenWhere(here), "Fisherman's Wharf, in San Francisco");
  });

  it('strips wikipedia pronunciation so speech is speakable', () => {
    const raw = 'The Eiffel Tower ( EYE-fəl; French: Tour Eiffel [tuʁ ɛfɛl] ) is a lattice tower on the Champ de Mars in Paris, France.';
    const out = narrate.humanizeExtract(raw, 2);
    assert.doesNotMatch(out, /EYE/);
    assert.doesNotMatch(out, /tuʁ/);
    assert.doesNotMatch(out, /\[/);
    assert.match(out, /Eiffel Tower/);
    assert.match(out, /Paris/);
    assert.doesNotMatch(narrate.stripWikiSpeak('a one-mile-wide (1.6 km) strait'), /\(1\.6 km\)/);
  });

  it('writes a conversational tour-guide script from nearby places', () => {
    const here = { label: 'Times Square, New York', neighborhood: 'Times Square', city: 'New York' };
    const places = [
      { title: 'Paramount Building', distanceMeters: 40, extract: 'It is an office building. It opened in 1927. Extra sentence.' },
      { title: 'One Times Square', distanceMeters: 120, extract: 'The ball drop happens here.' },
    ];
    const script = narrate.buildAreaScript(here, places);
    assert.match(script, /we're in Times Square, in New York/i);
    assert.match(script, /Paramount Building/);
    assert.match(script, /One Times Square/);
    assert.doesNotMatch(script, /Tap a place/);
    assert.doesNotMatch(script, /I'm your local guide/);
    assert.match(script, /It's an office building/);
  });

  it('handles an empty radius without crashing', () => {
    const script = narrate.buildAreaScript({ label: 'Open countryside' }, []);
    assert.match(script, /don't see a famous landmark/i);
  });

  it('uses walking language for distance', () => {
    assert.equal(narrate.formatDistance(20), 'right here');
    assert.equal(narrate.formatDistance(120), 'a few steps away');
    assert.match(narrate.buildPlaceScript({
      title: 'Golden Gate Bridge',
      distanceMeters: 15,
      extract: 'The Golden Gate Bridge is a suspension bridge spanning the Golden Gate.',
    }), /This is the Golden Gate Bridge/);
  });

  it('ranks closer illustrated places higher', () => {
    const ranked = narrate.rankPlaces([
      { title: 'Far', distanceMeters: 3000, extract: 'x', thumbnail: null },
      { title: 'Near', distanceMeters: 80, extract: 'A longer extract that scores.', thumbnail: 'https://upload.wikimedia.org/x.jpg' },
    ]);
    assert.equal(ranked[0].title, 'Near');
  });

  it('chunks long tour scripts for speech', () => {
    const script = 'First sentence is short. Second sentence is also fine. Third keeps going.';
    const chunks = narrate.chunkForSpeech(script, 40);
    assert.ok(chunks.length >= 2);
    assert.equal(chunks.join(' '), script);
    assert.deepEqual(narrate.chunkForSpeech(''), []);
  });
});
