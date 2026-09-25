import { Tabs } from 'expo-router';
import { colors } from '../../src/theme';
export default function TabLayout() {
  return <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: colors.green, tabBarInactiveTintColor: colors.muted,
    tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border, height: 58, paddingBottom: 6 }, tabBarLabelStyle: { fontSize: 12, fontWeight: '600' } }}>
    <Tabs.Screen name="index" options={{ title: 'Неделя' }} />
    <Tabs.Screen name="recipes" options={{ title: 'Рецепты' }} />
    <Tabs.Screen name="shopping" options={{ title: 'Покупки' }} />
    <Tabs.Screen name="profile" options={{ title: 'Профиль' }} />
  </Tabs>;
}
