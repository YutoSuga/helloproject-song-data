import { legacyDestination, pathOf } from './site-state.js';

location.replace(legacyDestination(pathOf(location), new URLSearchParams(location.search)));
