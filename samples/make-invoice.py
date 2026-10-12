from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor
from pathlib import Path
from datetime import datetime
root=Path.cwd()
out=root/'samples'/'tuition-invoice.pdf'
c=canvas.Canvas(str(out),pagesize=(595,842))
c.setTitle('FinMate sample tuition invoice - simulated')
c.setFillColor(HexColor('#f6f4ee'));c.rect(0,0,595,842,fill=1,stroke=0)
c.setFillColor(HexColor('#492c3d'));c.setFont('Helvetica-Bold',12);c.drawString(48,786,'FINMATE / SAMPLE DOCUMENT')
c.setFont('Times-Roman',34);c.drawString(48,711,'Tuition invoice')
c.setFont('Helvetica',11);c.drawString(48,679,'University of Amsterdam - simulated student account')
c.setStrokeColor(HexColor('#ded9d4'));c.line(48,650,547,650)
rows=[('Invoice reference','UVA-2026-JL-1101'),('Recipient','University of Amsterdam'),('Account','DEMO-UVA-EUR-001'),('Currency','EUR'),('Amount due','2300.00'),('Due date','2026-11-01'),('Student','Jamie Li')]
y=603
for key,value in rows:
    c.setFont('Helvetica',12);c.drawString(48,y,f'{key}: {value}');y-=37
c.line(48,315,547,315)
c.setFont('Helvetica-Bold',10);c.drawString(48,282,'SIMULATION ONLY - NO REAL PAYMENT REQUEST')
c.setFont('Helvetica',10);c.drawString(48,259,'Use this document to test extraction, field verification and tuition planning.')
c.drawString(48,239,'The account identifier is fictitious. All prototype transactions are simulated.')
c.setFont('Helvetica',9);c.drawString(48,54,'FinMate - Your money, at home anywhere.');c.drawRightString(547,54,'1 / 1')
c.save()
