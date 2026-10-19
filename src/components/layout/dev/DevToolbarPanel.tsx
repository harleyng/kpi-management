import { Separator } from '@/components/ui/separator';
import { DevClockSection } from './DevClockSection';
import { DevFailureSection } from './DevFailureSection';
import { DevLatencySection } from './DevLatencySection';
import { DevResetSection } from './DevResetSection';
import { DevSchedulerSection } from './DevSchedulerSection';

/** The toolbar's sections — a lazy chunk, so only the trigger ships with the shell. */
export default function DevToolbarPanel() {
  return (
    <>
      <DevClockSection />
      <Separator />
      <DevLatencySection />
      <Separator />
      <DevFailureSection />
      <Separator />
      <DevSchedulerSection />
      <Separator />
      <DevResetSection />
    </>
  );
}
