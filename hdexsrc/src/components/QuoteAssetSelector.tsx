import React, { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useMarketStore } from '../store/useMarketStore';
import { backgroundService } from '../services/background_service';

/** Shared by the market list and home rankings. */
export const QuoteAssetSelector: React.FC = () => {
  const [visible, setVisible] = useState(false);
  const pairs = useMarketStore(state => state.chainPairs);
  const selected = useMarketStore(state => state.selectedQuoteAsset);
  const select = useMarketStore(state => state.setSelectedQuoteAsset);
  const loading = useMarketStore(state => state.chainMarketsLoading);
  const loaded = useMarketStore(state => state.chainMarketsLoaded);
  const error = useMarketStore(state => state.chainMarketsError);
  const options = useMemo(() => {
    const counts = new Map<string, number>();
    pairs.forEach(pair => counts.set(pair.quote, (counts.get(pair.quote) || 0) + 1));
    return [
      { asset: null, label: '全部', count: pairs.length },
      ...Array.from(counts).sort(([a], [b]) => a.localeCompare(b))
        .map(([asset, count]) => ({ asset, label: asset, count })),
    ];
  }, [pairs]);

  return (
    <>
      <Pressable
        testID="quote-asset-selector"
        style={styles.trigger}
        accessibilityRole="button"
        accessibilityLabel={`选择报价资产，当前${selected || '全部'}`}
        onPress={() => {
          setVisible(true);
          backgroundService.refreshChainMarkets();
        }}
      >
        <Text style={styles.triggerText} numberOfLines={1}>{selected || '全部'}</Text>
        <Icon name="menu-down" size={22} color="#AAAAAA" />
      </Pressable>
      <Modal visible={visible} transparent animationType="slide" onRequestClose={() => setVisible(false)}>
        <View style={styles.overlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setVisible(false)} accessibilityLabel="关闭报价资产选择" />
          <SafeAreaView edges={['bottom']} style={styles.sheet}>
            <View style={styles.handle} />
            <View style={styles.titleRow}>
              <Text style={styles.title}>选择报价资产</Text>
              <Pressable onPress={() => setVisible(false)} accessibilityLabel="关闭" hitSlop={10}>
                <Icon name="close" size={22} color="#888888" />
              </Pressable>
            </View>
            {loading && !loaded && <ActivityIndicator style={styles.status} color="#00D094" />}
            {error && (
              <Pressable style={styles.status} onPress={() => backgroundService.refreshChainMarkets(true)}>
                <Text style={styles.error}>{error}</Text>
              </Pressable>
            )}
            {loaded && pairs.length === 0 && <Text style={styles.empty}>暂无链上交易对</Text>}
            {pairs.length > 0 && (
              <FlatList
                style={styles.list}
                data={options}
                keyExtractor={item => item.asset || 'all'}
                renderItem={({ item }) => (
                  <Pressable
                    testID={`quote-option-${item.asset || 'all'}`}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected === item.asset }}
                    style={styles.option}
                    onPress={() => { select(item.asset); setVisible(false); }}
                  >
                    <Text style={[styles.optionText, selected === item.asset && styles.selected]}>{item.label}</Text>
                    <Text style={styles.count}>{item.count} 个交易对</Text>
                    {selected === item.asset && <Icon name="check" size={22} color="#00D094" />}
                  </Pressable>
                )}
              />
            )}
          </SafeAreaView>
        </View>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  trigger: { flexDirection: 'row', alignItems: 'center', minHeight: 38, maxWidth: 120, paddingLeft: 10 },
  triggerText: { color: '#AAAAAA', fontSize: 13, flexShrink: 1 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#1A1A1A', borderTopLeftRadius: 18, borderTopRightRadius: 18, maxHeight: '70%', paddingHorizontal: 20 },
  handle: { width: 36, height: 4, backgroundColor: '#555555', borderRadius: 2, alignSelf: 'center', marginTop: 10, marginBottom: 20 },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  title: { color: '#FFFFFF', fontSize: 17, fontWeight: '600' },
  list: { flexGrow: 0 },
  option: { minHeight: 56, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#303030' },
  optionText: { color: '#EEEEEE', fontSize: 17, flexShrink: 1 },
  selected: { color: '#00D094' },
  count: { color: '#777777', fontSize: 12, flex: 1, textAlign: 'right', marginHorizontal: 12 },
  status: { paddingVertical: 20 },
  error: { color: '#E6BD4A', textAlign: 'center' },
  empty: { color: '#888888', textAlign: 'center', paddingVertical: 24 },
});
