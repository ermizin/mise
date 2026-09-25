import { Redirect } from 'expo-router';
import { useApp } from '../src/app-state';
import { Screen, Status } from '../src/ui';
export default function Home() {
  const { loading, error, onboarded, refresh } = useApp();
  if (loading || error) return <Screen><Status loading={loading} error={error} retry={refresh} /></Screen>;
  return <Redirect href={onboarded ? '/(tabs)' : '/onboarding'} />;
}
