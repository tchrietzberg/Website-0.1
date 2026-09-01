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
  });

  it('writes a tour-guide script from nearby places', () => {
    const here = { label: 'Times Square, New York' };
    const places = [
      { title: 'Paramount Building', distanceMeters: 40, extract: 'It is an office building. It opened in 1927. Extra sentence.' },
      { title: 'One Times Square', distanceMeters: 120, extract: 'The ball drop happens here.' },
    ];
    const script = narrate.buildAreaScript(here, places);
    assert.match(script, /You are in Times Square, New York/);
    assert.match(script, /local guide/);
    assert.match(script, /Paramount Building/);
    assert.match(script, /One Times Square/);
  });

  it('handles an empty radius without crashing', () => {
    const script = narrate.buildAreaScript({ label: 'Open countryside' }, []);
    assert.match(script, /don't have a notable landmark/i);
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
