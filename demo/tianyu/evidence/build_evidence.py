from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.platypus import SimpleDocTemplate,Paragraph,Spacer
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.pagesizes import A4
from pathlib import Path

pdfmetrics.registerFont(UnicodeCIDFont('STSong-Light'));root=Path(__file__).resolve().parent;out=root/'天雨_沧海化工_技术与供货确认单.pdf'
styles=ParagraphStyle('body',fontName='STSong-Light',fontSize=10.5,leading=17,spaceAfter=5,wordWrap='CJK')
items=[]
for i,line in enumerate((root/'天雨_沧海化工_技术与供货确认单.txt').read_text().splitlines()):
 if not line:items.append(Spacer(1,7));continue
 st=ParagraphStyle('line'+str(i),parent=styles,fontSize=19 if i==0 else 10.5,leading=26 if i==0 else 17)
 items.append(Paragraph(line,st))
SimpleDocTemplate(str(out),pagesize=A4,rightMargin=50,leftMargin=50,topMargin=48,bottomMargin=45,title='天雨虚构项目技术与供货确认单',author='Osborn Studio').build(items)
print('Created technical evidence PDF')
