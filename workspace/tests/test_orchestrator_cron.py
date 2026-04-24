import os
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
ENSURE_SCRIPT = REPO_ROOT / "scripts" / "ensure_chemlake_orchestrator.sh"
INSTALL_SCRIPT = REPO_ROOT / "scripts" / "install_chemlake_orchestrator_cron.sh"
CRON_EXAMPLE = REPO_ROOT / "slurm" / "chemlake-orchestrator.cron"


def _make_fake_slurm(tmp_path: Path) -> Path:
    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    (fake_bin / "squeue").write_text(
        "#!/usr/bin/env bash\n"
        "printf '%s\\n' \"${FAKE_SQUEUE_OUTPUT:-}\"\n",
        encoding="utf-8",
    )
    (fake_bin / "sbatch").write_text(
        "#!/usr/bin/env bash\n"
        "printf '%s\\n' \"$*\" >> \"${SBATCH_LOG}\"\n"
        "printf 'Submitted batch job 12345\\n'\n",
        encoding="utf-8",
    )
    (fake_bin / "scancel").write_text(
        "#!/usr/bin/env bash\n"
        "printf '%s\\n' \"$*\" >> \"${SCANCEL_LOG}\"\n",
        encoding="utf-8",
    )
    (fake_bin / "chemlake").write_text(
        "#!/usr/bin/env bash\n"
        "printf '%s\\n' \"$*\" >> \"${CHEMLAKE_LOG}\"\n"
        "exit \"${FAKE_HEARTBEAT_EXIT:-0}\"\n",
        encoding="utf-8",
    )
    (fake_bin / "squeue").chmod(0o755)
    (fake_bin / "sbatch").chmod(0o755)
    (fake_bin / "scancel").chmod(0o755)
    (fake_bin / "chemlake").chmod(0o755)
    return fake_bin


def _make_hive_checkout(tmp_path: Path) -> Path:
    root = tmp_path / "checkout"
    (root / "slurm").mkdir(parents=True)
    (root / "logs").mkdir()
    (root / "slurm" / "chemlake-orchestrator.sbatch").write_text("#!/usr/bin/env bash\n", encoding="utf-8")
    return root


def _run_ensure(tmp_path: Path, *, squeue_output: str, heartbeat_exit: str = "0") -> subprocess.CompletedProcess:
    root = _make_hive_checkout(tmp_path)
    fake_bin = _make_fake_slurm(tmp_path)
    env = os.environ.copy()
    env.update(
        {
            "CHEMLAKE_REPO_ROOT": str(root),
            "CHEMLAKE_CRON_PATH": str(fake_bin),
            "FAKE_SQUEUE_OUTPUT": squeue_output,
            "SBATCH_LOG": str(tmp_path / "sbatch.log"),
            "SCANCEL_LOG": str(tmp_path / "scancel.log"),
            "CHEMLAKE_LOG": str(tmp_path / "chemlake.log"),
            "FAKE_HEARTBEAT_EXIT": heartbeat_exit,
            "CHEMLAKE_ORCHESTRATOR_RUNNER": "chemlake",
            "USER": "hiveuser",
        }
    )
    return subprocess.run([str(ENSURE_SCRIPT)], env=env, text=True, capture_output=True)


def test_cron_ensure_submits_orchestrator_when_none_is_active(tmp_path):
    result = _run_ensure(tmp_path, squeue_output="")

    assert result.returncode == 0
    assert "no active chemlake-orchestrator job" in result.stdout
    assert "slurm/chemlake-orchestrator.sbatch" in (tmp_path / "sbatch.log").read_text(encoding="utf-8")


def test_cron_ensure_does_not_submit_when_one_orchestrator_is_active(tmp_path):
    result = _run_ensure(tmp_path, squeue_output="123|RUNNING|chemlake-orchestrator")

    assert result.returncode == 0
    assert "already active" in result.stdout
    assert not (tmp_path / "sbatch.log").exists()
    assert "--assert-service" in (tmp_path / "chemlake.log").read_text(encoding="utf-8")


def test_cron_ensure_replaces_active_orchestrator_when_heartbeat_is_stale(tmp_path):
    result = _run_ensure(tmp_path, squeue_output="123|RUNNING|chemlake-orchestrator", heartbeat_exit="1")

    assert result.returncode == 0
    assert "heartbeat is stale" in result.stdout
    assert (tmp_path / "scancel.log").read_text(encoding="utf-8").strip() == "123"
    assert "slurm/chemlake-orchestrator.sbatch" in (tmp_path / "sbatch.log").read_text(encoding="utf-8")


def test_cron_ensure_fails_closed_when_more_than_one_orchestrator_is_active(tmp_path):
    result = _run_ensure(
        tmp_path,
        squeue_output="123|RUNNING|chemlake-orchestrator\n124|PENDING|chemlake-orchestrator",
    )

    assert result.returncode == 1
    assert "maximum allowed is 1" in result.stdout
    assert "123|RUNNING" in result.stderr
    assert not (tmp_path / "sbatch.log").exists()


def test_cron_install_and_example_are_present_and_reference_ensure_script():
    assert os.access(ENSURE_SCRIPT, os.X_OK)
    assert os.access(INSTALL_SCRIPT, os.X_OK)
    cron_text = CRON_EXAMPLE.read_text(encoding="utf-8")
    assert "ensure_chemlake_orchestrator.sh" in cron_text
    assert "*/5" in cron_text
