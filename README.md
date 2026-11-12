# Flâneur: take the scenic route

Maps that optimize for beauty, serendipity and aliveness instead of speed.
Flâneur shows the fastest walk next to up to three scenic alternatives
("+2 min · past Boulan Park · 4 cafés"), and a slider trades minutes for life.

**How it works**
1. Fastest walking route from OSRM (FOSSGIS public foot router).
2. Pulls parks, water, cafés, shops, landmarks, heritage buildings, pedestrian streets and busy roads around the trip from OpenStreetMap (Overpass).
3. Generates candidates through the best nearby anchors (parks, café clusters, landmarks), scores each route by what you actually pass within a few dozen meters, per km, with a variety bonus and a busy-road penalty.
4. Ranks by aliveness minus a time penalty set by the slider. Hand off to Google/Apple Maps for turn-by-turn.

No API keys. Static site: `index.html`, `app.js`, `style.css`. iOS app in `ios/`.

Data © OpenStreetMap contributors. Tiles: OpenFreeMap. Geocoding: Photon (komoot).
