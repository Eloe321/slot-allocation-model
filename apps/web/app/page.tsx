import { api } from '../lib/api';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const scenarios = await api.scenarios();

  return (
    <main>
      <h1>Slot Allocation Inspector</h1>
      <ul>
        {scenarios.map((s) => (
          <li key={s.key}>{s.title}</li>
        ))}
      </ul>
    </main>
  );
}
