import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppProvider } from '../src/app-state';
import { colors } from '../src/theme';
export default function RootLayout() {
  return <SafeAreaProvider><AppProvider><Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} /></AppProvider></SafeAreaProvider>;
}
