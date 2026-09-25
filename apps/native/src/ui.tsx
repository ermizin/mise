import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from './theme';

export function Screen({ children, scroll = true }: { children: React.ReactNode; scroll?: boolean }) {
  const insets = useSafeAreaInsets();
  const style = { paddingTop: Math.max(insets.top, 16), paddingBottom: Math.max(insets.bottom, 20) + 20 };
  return scroll ? <ScrollView style={styles.screen} contentContainerStyle={[styles.content, style]} keyboardShouldPersistTaps="handled">{children}</ScrollView>
    : <View style={[styles.screen, styles.content, style]}>{children}</View>;
}
export function Title({ children, subtitle }: { children: React.ReactNode; subtitle?: string }) {
  return <View style={styles.titleWrap}><Text style={styles.title}>{children}</Text>{subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}</View>;
}
export function Card({ children }: { children: React.ReactNode }) { return <View style={styles.card}>{children}</View>; }
export function Label({ children }: { children: React.ReactNode }) { return <Text style={styles.label}>{children}</Text>; }
export function Body({ children, muted = false }: { children: React.ReactNode; muted?: boolean }) { return <Text style={[styles.body, muted && styles.muted]}>{children}</Text>; }
export function Button({ title, onPress, secondary = false, disabled = false, accessibilityLabel }: { title: string; onPress: () => void; secondary?: boolean; disabled?: boolean; accessibilityLabel?: string }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? title} accessibilityState={{ disabled }} onPress={onPress} disabled={disabled}
    style={({ pressed }) => [styles.button, secondary && styles.buttonSecondary, disabled && styles.disabled, pressed && styles.pressed]}>
    <Text style={[styles.buttonText, secondary && styles.buttonSecondaryText]}>{title}</Text></Pressable>;
}
export function Choice({ title, selected, onPress, detail }: { title: string; selected: boolean; onPress: () => void; detail?: string }) {
  return <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: selected }} onPress={onPress} style={[styles.choice, selected && styles.choiceSelected]}>
    <View style={styles.choiceText}><Text style={styles.choiceTitle}>{title}</Text>{detail ? <Text style={styles.muted}>{detail}</Text> : null}</View>
    <Text style={styles.check}>{selected ? '✓' : '○'}</Text></Pressable>;
}
export function Field({ label, value, onChangeText, keyboardType = 'default', placeholder }: { label: string; value: string; onChangeText: (value: string) => void; keyboardType?: 'default' | 'numeric'; placeholder?: string }) {
  return <View style={styles.field}><Label>{label}</Label><TextInput accessibilityLabel={label} value={value} onChangeText={onChangeText} keyboardType={keyboardType} placeholder={placeholder}
    placeholderTextColor={colors.muted} style={styles.input} autoCapitalize="sentences" /></View>;
}
export function Status({ loading, error, empty, retry }: { loading?: boolean; error?: string | null; empty?: string; retry?: () => void }) {
  if (loading) return <View style={styles.status}><ActivityIndicator color={colors.green} /><Body>Загружаем…</Body></View>;
  if (error) return <Card><Text style={styles.error}>{error}</Text>{retry ? <Button title="Повторить" onPress={retry} secondary /> : null}</Card>;
  if (empty) return <Card><Body muted>{empty}</Body></Card>;
  return null;
}
export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background }, content: { paddingHorizontal: 20, gap: 16 },
  titleWrap: { gap: 6, marginBottom: 8 }, title: { fontSize: 29, lineHeight: 34, fontWeight: '700', color: colors.text },
  subtitle: { fontSize: 15, lineHeight: 22, color: colors.muted }, card: { backgroundColor: colors.surface, borderRadius: 20, borderWidth: 1, borderColor: colors.border, padding: 18, gap: 12 },
  label: { color: colors.text, fontSize: 14, fontWeight: '600' }, body: { fontSize: 16, lineHeight: 23, color: colors.text }, muted: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  button: { minHeight: 50, borderRadius: 14, paddingHorizontal: 18, paddingVertical: 13, justifyContent: 'center', backgroundColor: colors.green, alignItems: 'center' },
  buttonSecondary: { backgroundColor: colors.pale }, buttonText: { color: 'white', fontSize: 16, fontWeight: '700' }, buttonSecondaryText: { color: colors.green }, disabled: { opacity: 0.45 }, pressed: { opacity: 0.75 },
  choice: { minHeight: 52, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', gap: 10 },
  choiceSelected: { borderColor: colors.green, backgroundColor: colors.pale }, choiceText: { flex: 1, gap: 2 }, choiceTitle: { color: colors.text, fontSize: 16, fontWeight: '600' }, check: { fontSize: 22, color: colors.green },
  field: { gap: 6 }, input: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, minHeight: 48, paddingHorizontal: 14, borderRadius: 12, color: colors.text, fontSize: 16 },
  status: { alignItems: 'center', padding: 24, gap: 12 }, error: { color: colors.error, fontSize: 15, lineHeight: 22 },
});
