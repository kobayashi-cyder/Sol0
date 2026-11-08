"""Audit v0.12 demo outputs with Pillow, wave, FFprobe and ZIP CRC."""
import json
import subprocess
import wave
import zipfile
from pathlib import Path
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
S=ROOT/'samples'

def run():
    report={}
    for filename in ['image.png','animation.gif']:
        with Image.open(S/filename) as im:
            frames=getattr(im,'n_frames',1)
            for i in range(frames):
                im.seek(i)
                im.load()
            report[filename]={'format':im.format,'size':im.size,'frames':frames}
    with wave.open(str(S/'audio.wav')) as f:
        assert f.getnchannels()==1 and f.getframerate()==16000
        report['audio.wav']={'sample_rate':f.getframerate(),'frames':f.getnframes(),'channels':f.getnchannels()}
    for filename in ['movie.webm','movie.mp4']:
        proc=subprocess.run(['ffprobe','-v','error','-show_entries','stream=codec_type,codec_name','-of','json',str(S/filename)],capture_output=True,text=True,check=True,timeout=20)
        streams=json.loads(proc.stdout)['streams']
        assert {'audio','video'} <= {s['codec_type'] for s in streams}
        report[filename]={'streams':streams}
    with zipfile.ZipFile(S/'project.zip') as z:
        assert z.testzip() is None
        assert 'project.json' in z.namelist()
        report['project.zip']={'entries':len(z.namelist())}
    print(json.dumps(report,indent=2,ensure_ascii=False))
    return report

if __name__=='__main__':run()
