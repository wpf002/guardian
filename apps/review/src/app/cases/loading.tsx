import { LoadingState } from "@/components";
import styles from "@/components/case/Case.module.css";

export default function CasesLoading() {
  return (
    <div className={`container ${styles.routeState}`}>
      <LoadingState label="Loading the open cases in your partition." count={6} rowHeight={84} />
    </div>
  );
}
