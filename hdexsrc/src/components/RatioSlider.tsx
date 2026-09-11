import React, { useMemo, useRef } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';

interface RatioSliderProps {
  value: number;
  minimum: number;
  maximum: number;
  label: string;
  onChange: (value: number) => void;
  onSlidingChange: (sliding: boolean) => void;
}

export const ratioAtPosition = (x: number, width: number, minimum: number, maximum: number) => {
  const progress = width > 0 ? Math.max(0, Math.min(1, x / width)) : 0;
  return Math.round((minimum + progress * (maximum - minimum)) * 100) / 100;
};

/** Keep the responder and measured track stable while the parent updates amounts. */
export const RatioSlider: React.FC<RatioSliderProps> = props => {
  const latest = useRef(props);
  latest.current = props;
  const track = useRef<View>(null);
  const gesture = useRef({ active: false, generation: 0, x: 0, left: 0, width: 0 });
  const responder = useMemo(() => {
    const update = () => {
      const g = gesture.current;
      if (!g.active || g.width <= 0) return;
      const { minimum, maximum, onChange } = latest.current;
      onChange(ratioAtPosition(g.x - g.left, g.width, minimum, maximum));
    };
    const finish = () => {
      gesture.current.active = false;
      latest.current.onSlidingChange(false);
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: event => {
        const g = gesture.current;
        g.active = true;
        g.x = event.nativeEvent.pageX;
        g.width = 0;
        const generation = ++g.generation;
        latest.current.onSlidingChange(true);
        track.current?.measureInWindow((left, _top, width) => {
          if (!g.active || g.generation !== generation) return;
          g.left = left;
          g.width = width;
          update();
        });
      },
      onPanResponderMove: event => {
        gesture.current.x = event.nativeEvent.pageX;
        update();
      },
      onPanResponderRelease: event => {
        gesture.current.x = event.nativeEvent.pageX;
        update();
        finish();
      },
      onPanResponderTerminate: finish,
    });
  }, []);
  const progress = Math.max(0, Math.min(1, (props.value - props.minimum) / (props.maximum - props.minimum)));
  const percentage = `${progress * 100}%` as `${number}%`;
  return (
    <View
      style={styles.touch}
      {...responder.panHandlers}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={props.label}
      accessibilityValue={{ min: props.minimum, max: props.maximum, now: props.value }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={event => props.onChange(Math.max(props.minimum, Math.min(props.maximum,
        props.value + (event.nativeEvent.actionName === 'increment' ? 0.1 : -0.1))))}
    >
      <View ref={track} collapsable={false} style={styles.track} pointerEvents="none">
        <View style={[styles.fill, { width: percentage }]} />
        <View style={[styles.thumb, { left: percentage }]} />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  touch: { height: 30, justifyContent: 'center', paddingHorizontal: 10, marginTop: 2 },
  track: { height: 6, borderRadius: 3, backgroundColor: '#3A423E', justifyContent: 'center' },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 3, backgroundColor: '#00D5A3' },
  thumb: { position: 'absolute', width: 22, height: 22, marginLeft: -11, borderRadius: 11, borderWidth: 4, borderColor: '#00D5A3', backgroundColor: '#111513' },
});
