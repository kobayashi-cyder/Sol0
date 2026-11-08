"""Convert Sol-Zero's local WebM into MP4 using installed FFmpeg.
No pretrained weights, network, uploads, or external inference.
"""
import argparse
import subprocess
from pathlib import Path


def convert(source: Path, target: Path) -> None:
    if not source.is_file() or source.suffix.lower() != '.webm':
        raise ValueError('The source must be an existing .webm file')
    if source.stat().st_size > 200_000_000:
        raise ValueError('Source must be below 200 MB')
    if target.suffix.lower() != '.mp4':
        raise ValueError('Target must be .mp4')
    target.parent.mkdir(parents=True, exist_ok=True)
    command = ['ffmpeg','-nostdin','-hide_banner','-loglevel','error','-y','-i',str(source),'-map','0:v:0','-map','0:a:0?','-c:v','libx264','-preset','medium','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart',str(target)]
    subprocess.run(command, check=True, timeout=180)
    if not target.is_file() or target.stat().st_size <= 100:
        raise RuntimeError('MP4 output was not produced')


def main() -> None:
    cli=argparse.ArgumentParser(description=__doc__)
    cli.add_argument('source',type=Path)
    cli.add_argument('target',type=Path)
    args=cli.parse_args()
    convert(args.source,args.target)
    print(f'MP4 created: {args.target} ({args.target.stat().st_size:,} bytes)')


if __name__=='__main__':
    main()
