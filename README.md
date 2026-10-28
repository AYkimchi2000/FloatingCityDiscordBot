GOOGLE COMPUTE ENGINE remote SSH commands


sudo apt update
sudo apt install -y nodejs npm git
sudo npm install -g pm2

git clone https://github.com/your-username/your-repo.git
cd your-repo
npm install

nano .env 

pm2 start index.js --name "discord-bot"
pm2 save
pm2 startup
(run the generated line)


## delete the specific process startup 
pm2 delete discord-bot
pm2save

## Delete PM2 itself and all related
pm2 delete all
pm2 save
pm2 unstartup
(run the generated line)
