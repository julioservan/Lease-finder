#!/usr/bin/env node
/** Verifica que las fotos de los 11 modelos existen en Wikipedia (corre en CI). */
'use strict';

var models = require('../js/models.js');

(async function () {
  var failures = 0;
  for (var i = 0; i < models.length; i++) {
    var m = models[i];
    var title = m.wiki.replace(/ /g, '_');
    try {
      var r = await fetch('https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(title));
      var d = r.ok ? await r.json() : null;
      var thumb = d && d.thumbnail && d.thumbnail.source;
      var line = (m.make + ' ' + m.model + ':').padEnd(28) + 'summary=' + r.status + ' thumb=' + (thumb ? 'sí' : 'NO');
      if (thumb) {
        var big = thumb.replace(/\/(\d+)px-/, '/640px-');
        var rBig = await fetch(big, { method: 'HEAD' });
        var rThumb = await fetch(thumb, { method: 'HEAD' });
        line += ' | 640px=' + rBig.status + ' | nativo=' + rThumb.status;
        if (!rThumb.ok) failures++;
      } else {
        failures++;
      }
      console.log(line);
    } catch (e) {
      failures++;
      console.log(m.make + ' ' + m.model + ': ERROR ' + e.message);
    }
  }
  console.log('\n' + (failures ? failures + ' modelo(s) sin foto utilizable' : 'Todas las fotos disponibles ✅'));
  process.exit(failures ? 1 : 0);
})();
