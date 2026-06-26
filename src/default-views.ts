import type { ViewDefinition } from './types';
import demographics from '../views/demographics.json';
import conditions from '../views/conditions.json';
import medications from '../views/medications.json';
import allergies from '../views/allergies.json';
import labs from '../views/labs.json';
import vitals from '../views/vitals.json';
import procedures from '../views/procedures.json';
import immunizations from '../views/immunizations.json';
import encounters from '../views/encounters.json';

// Statically imported so `bun build --compile` bundles them into the standalone
// binary. This is the default view set used when `--views` is not supplied, so
// the `tokempic` binary works from any directory without the repo's views/ dir.
export const defaultViews: ViewDefinition[] = [
  demographics,
  conditions,
  medications,
  allergies,
  labs,
  vitals,
  procedures,
  immunizations,
  encounters,
] as unknown as ViewDefinition[];
