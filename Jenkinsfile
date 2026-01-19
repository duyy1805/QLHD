pipeline {
    agent any

    environment {
        IMAGE_NAME = "qlhd-server:latest"
        CONTAINER_NAME = "qlhd-server"
        APP_PORT = "3000"
    }

    stages {

        stage('Checkout source') {
            steps {
                checkout scm
            }
        }

        stage('Build Docker image (server)') {
            steps {
                dir('server') {
                    sh '''
                    echo "=== Build Docker image ==="
                    docker build -t ${IMAGE_NAME} .
                    '''
                }
            }
        }

        stage('Run container with env file') {
            steps {
                withCredentials([
                    file(credentialsId: 'qlhd-env-file', variable: 'ENV_FILE')
                ]) {
                    sh '''
                    echo "=== Copy .env to /tmp ==="
                    cp "$ENV_FILE" /tmp/qlhd.env

                    docker rm -f qlhd-server || true

                    docker run -d \
                    --name qlhd-server \
                    --env-file /tmp/qlhd.env \
                    -p 3000:3000 \
                    --restart always \
                    qlhd-server:latest
                    '''
                }
            }
        }
    }

    post {
        success {
            echo "✅ DEPLOY SUCCESS: qlhd-server is running on port ${APP_PORT}"
        }
        failure {
            echo "❌ DEPLOY FAILED"
        }
    }
}
